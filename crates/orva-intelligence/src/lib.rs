//! ORVA Core — Intelligence Engine (M8 + ADR 0018)
//!
//! สองชั้น: (1) rule-based — Event → Context Engine → Rules → Insight →
//! Notification (ARCHITECTURE.md §9, ดู [`IntelligenceEngine`]) และ (2) AI —
//! [`Analyst`] วิเคราะห์ context ขององค์กรตามคำถาม แล้วเสนอ recommendation
//! ที่มนุษย์ accept/dismiss (ไม่ execute เอง)

mod ai;
mod context;
mod engine;
mod metric;

pub use ai::{AiAnalysis, AiRecommendation, Analyst, BoxFuture, ClaudeAnalyst, DEFAULT_MODEL};
pub use context::ContextEngine;
pub use engine::{subscribe, IntelligenceEngine};
pub use metric::Metric;
pub use orva_data::{Insight, IntelligenceRule};
