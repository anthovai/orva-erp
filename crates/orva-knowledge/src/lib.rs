//! ORVA Knowledge (ADR 0017) — linked notes / knowledge graph ต่อ tenant
//!
//! แนวคิดจาก Obsidian (**concept เท่านั้น** — โค้ด/แอปใช้ไม่ได้ตาม license,
//! ARCHITECTURE.md §9): โน้ตอ้างถึงกันด้วย `[[ชื่อโน้ต]]` และอ้าง canonical entity
//! ของ ERP ได้ตรง ๆ ด้วย `[[employee:email]]` / `[[product:sku]]` — ทำให้ความรู้
//! ผูกกับข้อมูลธุรกิจจริง ไม่ใช่เอกสารลอย ๆ

mod parser;
mod service;

pub use orva_data::{KnowledgeLink, KnowledgeNote};
pub use parser::{parse_links, LinkTarget};
pub use service::{KnowledgeGraph, KnowledgeService, NoteWithLinks};
