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
    /// สิ่งที่ identity นี้ทำได้ใน Agent API (ADR 0011) — ว่าง = ทำอะไรไม่ได้เลย (fail-closed)
    pub scopes: Vec<String>,
}

impl ServiceIdentity {
    pub fn is_active(&self) -> bool {
        self.revoked_at.is_none()
    }

    /// เช็ค scope ตรงตัว เช่น `agent:context:read`
    pub fn has_scope(&self, scope: &str) -> bool {
        self.scopes.iter().any(|s| s == scope)
    }

    /// เช็คสิทธิ์ propose สำหรับ resource_type นี้ — ผ่านได้ 2 ทาง:
    /// scope กว้าง `agent:workflow:propose` หรือแบบเจาะจง
    /// `agent:workflow:propose:<resource_type>`
    pub fn may_propose(&self, resource_type: &str) -> bool {
        self.has_scope("agent:workflow:propose")
            || self.has_scope(&format!("agent:workflow:propose:{resource_type}"))
    }
}
