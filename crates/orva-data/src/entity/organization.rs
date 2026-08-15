use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Organization = tenant root ตาม ARCHITECTURE.md §3 — ไม่มี `organization_id` ของตัวเอง
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
pub struct Organization {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
    /// request/นาที ของทั้งองค์กร (ADR 0012) — `None` = ใช้ default ของระบบ
    pub rate_limit_per_minute: Option<i32>,
}
