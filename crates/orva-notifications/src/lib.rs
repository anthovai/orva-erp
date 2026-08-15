//! ORVA Core — Notification (M6)
//!
//! Channel แรก: `in_app` (เต็มรูปแบบ) + `email` (บันทึกแถวไว้ ยังไม่ส่งจริง — ดู MILESTONES.md M6)

mod service;
mod wiring;

pub use orva_data::{Notification, NotificationPreference};
pub use service::{NotificationService, CHANNEL_EMAIL, CHANNEL_IN_APP};
pub use wiring::subscribe_workflow_approval_requests;
