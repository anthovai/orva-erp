//! ORVA Sync — event-driven projection จาก external module เข้า canonical entities
//! (ADR 0016)
//!
//! external module publish event ผ่าน Agent API (`<module>.employee.created` ฯลฯ —
//! ดู docs/modules/horilla.md Phase 3) → subscriber ตรงนี้ project ลงตาราง canonical
//! (`employees`) ให้ทุก module/intelligence เห็นข้อมูลรูปแบบเดียวกัน โดย **event log
//! ยังเป็น source of truth** — projection สร้างใหม่ได้เสมอจากการ replay event

use std::sync::Arc;

use orva_data::{Employee, EmployeeFields, EmployeeRepository};
use orva_error::Result;
use orva_events::EventBus;

/// event_type ที่รู้จัก: `<module>.employee.<created|updated|deleted>` — module อื่น
/// (InvenTree ฯลฯ) ใช้ contract เดียวกันได้ทันทีโดยไม่ต้องแก้โค้ดนี้
fn parse_employee_event(event_type: &str) -> Option<(&str, &str)> {
    let mut parts = event_type.splitn(3, '.');
    let module = parts.next()?;
    if parts.next()? != "employee" {
        return None;
    }
    let action = parts.next()?;
    matches!(action, "created" | "updated" | "deleted").then_some((module, action))
}

/// หา id ของแถวในระบบต้นทาง — contract หลักคือ key `source_id`;
/// fallback เป็น `<module>_employee_id` (รูปแบบที่ Horilla hooks รุ่นแรกส่ง)
fn extract_source_id(module: &str, payload: &serde_json::Value) -> Option<String> {
    let candidate = payload
        .get("source_id")
        .or_else(|| payload.get(format!("{module}_employee_id").as_str()))?;
    match candidate {
        serde_json::Value::String(s) if !s.is_empty() => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

async fn project(
    employees: &EmployeeRepository,
    event: &orva_data::Event,
) -> Result<Option<Employee>> {
    let Some((module, action)) = parse_employee_event(&event.event_type) else {
        return Ok(None);
    };
    let Some(source_id) = extract_source_id(module, &event.payload) else {
        tracing::warn!(event_type = %event.event_type, "employee event without source id — skipped");
        return Ok(None);
    };

    if action == "deleted" {
        employees
            .soft_delete_from_source(event.organization_id, module, &source_id)
            .await?;
        return Ok(None);
    }

    let str_field = |key: &str| {
        event
            .payload
            .get(key)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };
    let employee = employees
        .upsert_from_source(
            event.organization_id,
            module,
            &source_id,
            EmployeeFields {
                email: &str_field("email"),
                first_name: &str_field("first_name"),
                last_name: &str_field("last_name"),
                is_active: event
                    .payload
                    .get("is_active")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true),
            },
        )
        .await?;
    Ok(Some(employee))
}

/// ผูก projection เข้ากับ Event Bus — เรียกครั้งเดียวตอนประกอบ AppState
/// (pattern เดียวกับ `orva_notifications::subscribe_workflow_approval_requests`)
pub fn subscribe_employee_projection(bus: &EventBus, employees: EmployeeRepository) {
    let employees = Arc::new(employees);
    bus.subscribe_all(Arc::new(move |event| {
        let employees = employees.clone();
        Box::pin(async move {
            if let Some(employee) = project(&employees, &event).await? {
                tracing::debug!(employee_id = %employee.id, source = %employee.source_module, "canonical employee projected");
            }
            Ok(())
        })
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_employee_event_types() {
        assert_eq!(
            parse_employee_event("horilla.employee.created"),
            Some(("horilla", "created"))
        );
        assert_eq!(
            parse_employee_event("inventree.employee.deleted"),
            Some(("inventree", "deleted"))
        );
        assert_eq!(parse_employee_event("horilla.employee.promoted"), None);
        assert_eq!(parse_employee_event("workflow.created"), None);
        assert_eq!(parse_employee_event("employee.created"), None);
    }

    #[test]
    fn extracts_source_id_from_contract_or_fallback() {
        let with_source = serde_json::json!({"source_id": "42"});
        assert_eq!(
            extract_source_id("horilla", &with_source),
            Some("42".to_string())
        );
        let horilla_style = serde_json::json!({"horilla_employee_id": 7});
        assert_eq!(
            extract_source_id("horilla", &horilla_style),
            Some("7".to_string())
        );
        assert_eq!(extract_source_id("horilla", &serde_json::json!({})), None);
    }
}
