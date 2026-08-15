//! ORVA Core — Notification (M6)
//!
//! Channel: `in_app` (เต็มรูปแบบ) + `email` (ส่งจริงทาง SMTP เมื่อ config mailer — ADR 0008)

pub mod hub;
pub mod mailer;
mod service;
mod wiring;

pub use hub::NotificationHub;
pub use mailer::{EmailMessage, Mailer, SmtpConfig, SmtpMailer};
pub use orva_data::{Notification, NotificationPreference};
pub use service::{NotificationService, CHANNEL_EMAIL, CHANNEL_IN_APP};
pub use wiring::subscribe_workflow_approval_requests;
