use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// Event log entry — append-only (ARCHITECTURE.md §6) ไม่มี soft delete/update
///
/// `resource_type`/`resource_id` เป็น audit trail column (M6) — เติมเฉพาะ event ที่ผูกกับ
/// resource ชัดเจน (เช่น role.created ผูกกับ role_id) ไม่บังคับทุก event
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
pub struct Event {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub event_type: String,
    pub payload: Value,
    pub actor_user_id: Option<Uuid>,
    pub correlation_id: Uuid,
    pub occurred_at: DateTime<Utc>,
    pub resource_type: Option<String>,
    pub resource_id: Option<Uuid>,
}
