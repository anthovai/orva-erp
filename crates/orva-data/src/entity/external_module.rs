use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// OSS module ที่รันแยก process (ADR 0014) — ORVA เป็น authenticated proxy ให้ผ่าน
/// `/api/v1/ext/{name}/...` (คนละอย่างกับ [`crate::ModuleInstallation`] ที่เป็น
/// module compile-in ตาม ADR 0004)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
pub struct ExternalModule {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub name: String,
    pub base_url: String,
    pub enabled: bool,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
