use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
pub struct IntelligenceRule {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub name: String,
    pub event_type: String,
    pub metric: String,
    pub window_seconds: i32,
    pub operator: String,
    pub threshold: f64,
    pub notify_user_id: Option<Uuid>,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub created_by: Option<Uuid>,
    /// action ที่แนะนำเมื่อ rule trigger (ADR 0010) — engine จะสร้าง [`Recommendation`]
    /// ให้อัตโนมัติถ้ามีค่านี้ (เช่น `{"type":"workflow","definition_id":"..."}`)
    pub recommended_action: Option<Value>,
}

/// append-only เหมือน [`crate::Event`] (ARCHITECTURE.md §9)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
pub struct Insight {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub rule_id: Uuid,
    pub rule_name: String,
    pub title: String,
    pub description: String,
    pub metric_value: f64,
    pub threshold: f64,
    pub triggered_event_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

/// ข้อเสนอจาก Intelligence Engine ที่รอมนุษย์ตัดสินใจ (ADR 0010)
/// `pending` → `accepted` (อาจสร้าง workflow ต่อ) หรือ `dismissed`
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
pub struct Recommendation {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub insight_id: Uuid,
    pub rule_id: Uuid,
    pub title: String,
    pub description: String,
    pub suggested_action: Option<Value>,
    pub status: String,
    pub decided_by: Option<Uuid>,
    pub decided_at: Option<DateTime<Utc>>,
    pub resulting_workflow_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}
