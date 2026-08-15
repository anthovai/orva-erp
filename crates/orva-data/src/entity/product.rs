use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Canonical Product (ADR 0016) — projection จาก event `<module>.product.*`
/// (เช่น InvenTree Part) — `source_module`/`source_id` บอกที่มาเสมอ
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
pub struct Product {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub name: String,
    pub sku: String,
    pub description: String,
    pub is_active: bool,
    pub source_module: String,
    pub source_id: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}
