//! ORVA Sync — event-driven projection จาก external module เข้า canonical entities
//! (ADR 0016)
//!
//! external module publish event ผ่าน Agent API (`<module>.employee.*`,
//! `<module>.product.*` — ดู docs/modules/) → subscriber ตรงนี้ project ลงตาราง
//! canonical ให้ทุก module/intelligence เห็นข้อมูลรูปแบบเดียวกัน โดย **event log
//! ยังเป็น source of truth** — projection สร้างใหม่ได้เสมอจากการ replay event

use std::sync::Arc;

use orva_data::{
    EmployeeFields, EmployeeRepository, Event, Pool, ProductFields, ProductRepository,
};
use orva_error::Result;
use orva_events::EventBus;

/// entity ที่ projection รู้จัก — เพิ่ม canonical ตัวใหม่ = เพิ่ม variant + handler ที่นี่
const KNOWN_ENTITIES: [&str; 2] = ["employee", "product"];

/// event_type ที่รู้จัก: `<module>.<entity>.<created|updated|deleted>` — module อื่น
/// ใช้ contract เดียวกันได้ทันทีโดยไม่ต้องแก้โค้ดนี้
fn parse_projection_event(event_type: &str) -> Option<(&str, &str, &str)> {
    let mut parts = event_type.splitn(3, '.');
    let module = parts.next()?;
    let entity = parts.next()?;
    let action = parts.next()?;
    (KNOWN_ENTITIES.contains(&entity) && matches!(action, "created" | "updated" | "deleted"))
        .then_some((module, entity, action))
}

/// หา id ของแถวในระบบต้นทาง — contract หลักคือ key `source_id`;
/// fallback เป็น `<module>_<entity>_id` (รูปแบบที่ hook รุ่นแรก ๆ ส่ง)
fn extract_source_id(module: &str, entity: &str, payload: &serde_json::Value) -> Option<String> {
    let candidate = payload
        .get("source_id")
        .or_else(|| payload.get(format!("{module}_{entity}_id").as_str()))?;
    match candidate {
        serde_json::Value::String(s) if !s.is_empty() => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn str_field(payload: &serde_json::Value, key: &str) -> String {
    payload
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn bool_field(payload: &serde_json::Value, key: &str, default: bool) -> bool {
    payload
        .get(key)
        .and_then(|v| v.as_bool())
        .unwrap_or(default)
}

struct Projector {
    employees: EmployeeRepository,
    products: ProductRepository,
}

impl Projector {
    async fn project(&self, event: &Event) -> Result<()> {
        let Some((module, entity, action)) = parse_projection_event(&event.event_type) else {
            return Ok(());
        };
        let Some(source_id) = extract_source_id(module, entity, &event.payload) else {
            tracing::warn!(event_type = %event.event_type, "projection event without source id — skipped");
            return Ok(());
        };

        match (entity, action) {
            ("employee", "deleted") => {
                self.employees
                    .soft_delete_from_source(event.organization_id, module, &source_id)
                    .await?;
            }
            ("employee", _) => {
                self.employees
                    .upsert_from_source(
                        event.organization_id,
                        module,
                        &source_id,
                        EmployeeFields {
                            email: &str_field(&event.payload, "email"),
                            first_name: &str_field(&event.payload, "first_name"),
                            last_name: &str_field(&event.payload, "last_name"),
                            is_active: bool_field(&event.payload, "is_active", true),
                        },
                    )
                    .await?;
            }
            ("product", "deleted") => {
                self.products
                    .soft_delete_from_source(event.organization_id, module, &source_id)
                    .await?;
            }
            ("product", _) => {
                self.products
                    .upsert_from_source(
                        event.organization_id,
                        module,
                        &source_id,
                        ProductFields {
                            name: &str_field(&event.payload, "name"),
                            sku: &str_field(&event.payload, "sku"),
                            description: &str_field(&event.payload, "description"),
                            is_active: bool_field(&event.payload, "is_active", true),
                        },
                    )
                    .await?;
            }
            _ => {}
        }
        tracing::debug!(event_type = %event.event_type, %source_id, "canonical projection applied");
        Ok(())
    }
}

/// ผูก projection ทุก canonical entity เข้ากับ Event Bus — เรียกครั้งเดียวตอนประกอบ AppState
pub fn subscribe_canonical_projection(bus: &EventBus, pool: Pool) {
    let projector = Arc::new(Projector {
        employees: EmployeeRepository::new(pool.clone()),
        products: ProductRepository::new(pool),
    });
    bus.subscribe_all(Arc::new(move |event| {
        let projector = projector.clone();
        Box::pin(async move { projector.project(&event).await })
    }));
}

/// ชื่อเดิม (Employee อย่างเดียว) — คงไว้เพื่อ backward compat ของผู้เรียกภายนอก
#[deprecated(note = "ใช้ subscribe_canonical_projection แทน (ครอบทุก canonical entity)")]
pub fn subscribe_employee_projection(bus: &EventBus, employees: EmployeeRepository) {
    let _ = employees;
    let _ = bus;
    unimplemented!("replaced by subscribe_canonical_projection");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_projection_event_types() {
        assert_eq!(
            parse_projection_event("horilla.employee.created"),
            Some(("horilla", "employee", "created"))
        );
        assert_eq!(
            parse_projection_event("inventree.product.updated"),
            Some(("inventree", "product", "updated"))
        );
        assert_eq!(parse_projection_event("inventree.part.created"), None);
        assert_eq!(parse_projection_event("horilla.employee.promoted"), None);
        assert_eq!(parse_projection_event("workflow.created"), None);
    }

    #[test]
    fn extracts_source_id_from_contract_or_fallback() {
        let with_source = serde_json::json!({"source_id": "42"});
        assert_eq!(
            extract_source_id("inventree", "product", &with_source),
            Some("42".to_string())
        );
        let fallback = serde_json::json!({"inventree_product_id": 7});
        assert_eq!(
            extract_source_id("inventree", "product", &fallback),
            Some("7".to_string())
        );
        assert_eq!(
            extract_source_id("inventree", "product", &serde_json::json!({})),
            None
        );
    }
}
