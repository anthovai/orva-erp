use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
pub struct WorkflowInstance {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub resource_type: String,
    pub resource_id: Uuid,
    pub status: String,
    pub context: Value,
    pub rule: Option<Value>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub created_by: Option<Uuid>,
    /// definition ที่ instance นี้ถูกสร้างจาก (ADR 0009) — `None` = สร้างด้วย rule inline
    pub definition_id: Option<Uuid>,
}

/// Template ของ workflow ที่ตั้งค่าครั้งเดียวใช้ซ้ำได้ (ADR 0009)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
pub struct WorkflowDefinition {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub name: String,
    pub resource_type: String,
    pub rule: Option<Value>,
    pub default_approver_id: Option<Uuid>,
    pub enabled: bool,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
pub struct ApprovalTask {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub workflow_instance_id: Uuid,
    pub assigned_to: Uuid,
    pub status: String,
    pub decided_by: Option<Uuid>,
    pub decided_at: Option<DateTime<Utc>>,
    pub reason: Option<String>,
    pub created_at: DateTime<Utc>,
}
