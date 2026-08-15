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
