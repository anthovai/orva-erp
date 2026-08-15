use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// ให้ module/worker เรียก ORVA API แทนตัวเอง (ARCHITECTURE.md §2 — Service Identity)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
pub struct ServiceIdentity {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub name: String,
    #[serde(skip_serializing)]
    pub key_hash: String,
    pub created_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub created_by: Option<Uuid>,
}

impl ServiceIdentity {
    pub fn is_active(&self) -> bool {
        self.revoked_at.is_none()
    }
}
