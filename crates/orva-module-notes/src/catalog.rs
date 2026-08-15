//! Event ที่ module นี้ publish เอง — ประกาศไว้ในไฟล์ของตัวเอง ไม่ใช่แก้
//! `orva_events::catalog` (ซึ่งเป็น catalog ของ Core) ตรงตาม M7 DoD "ไม่แตะโค้ด Core"

pub const DOCUMENT_CREATED: &str = "notes.document.created";
pub const DOCUMENT_DELETED: &str = "notes.document.deleted";
