use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// งานที่ ORVA มอบให้ ORVA Worker (OpenWorker) ไปลงมือทำ (ADR 0019)
///
/// วงจร: `pending` → worker claim → `running` → worker รายงานผล →
/// `succeeded` / `failed` (หรือ `cancelled` ถ้ามนุษย์ยกเลิกก่อนถูก claim)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
pub struct WorkerTask {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub instruction: String,
    /// `manual` | `recommendation` | `workflow`
    pub source: String,
    pub source_id: Option<Uuid>,
    pub status: String,
    /// service identity ของ worker ที่ claim งานนี้
    pub claimed_by: Option<Uuid>,
    pub claimed_at: Option<DateTime<Utc>>,
    pub result: Option<String>,
    pub error: Option<String>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
