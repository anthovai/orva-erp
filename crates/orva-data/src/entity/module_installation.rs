use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// สถานะ install/enable/disable ของ module ต่อ organization (ARCHITECTURE.md §5)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
pub struct ModuleInstallation {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub module_name: String,
    pub version: String,
    pub enabled: bool,
    pub installed_at: DateTime<Utc>,
    pub installed_by: Option<Uuid>,
}
