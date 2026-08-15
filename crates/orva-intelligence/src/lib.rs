//! ORVA Core — Intelligence Foundation (M8)
//!
//! ยังไม่ใช่ AI — เป็น infrastructure: Event → Context Engine → Rules → Insight →
//! Notification (ARCHITECTURE.md §9) ดู [`IntelligenceEngine`] สำหรับจุดต่อหลัก

mod context;
mod engine;
mod metric;

pub use context::ContextEngine;
pub use engine::{subscribe, IntelligenceEngine};
pub use metric::Metric;
pub use orva_data::{Insight, IntelligenceRule};
