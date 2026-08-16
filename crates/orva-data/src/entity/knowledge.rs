use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// โน้ตความรู้ (ADR 0017) — เนื้อหาอ้างสิ่งอื่นด้วย `[[...]]` (ดู `orva-knowledge`)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
pub struct KnowledgeNote {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub title: String,
    pub content: String,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

/// ลิงก์ที่สกัดจากเนื้อหาโน้ต — `target_kind`: `note` | `employee` | `product`
/// (`to_note_id` = None สำหรับ note ที่ยังไม่ถูกสร้าง — resolve อัตโนมัติเมื่อสร้างทีหลัง)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
pub struct KnowledgeLink {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub from_note_id: Uuid,
    pub target_kind: String,
    pub target_ref: String,
    pub to_note_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}
