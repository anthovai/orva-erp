use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Canonical Employee (ADR 0016) — business entity แรกที่ implement จริงตาม
/// ARCHITECTURE.md §8 เติมข้อมูลด้วย event-driven projection จาก external module
/// (`source_module`/`source_id` บอกที่มา เช่น horilla + pk ฝั่งนั้น)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
pub struct Employee {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub is_active: bool,
    pub source_module: String,
    pub source_id: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}
