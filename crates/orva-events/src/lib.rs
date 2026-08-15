//! ORVA Core — Event Bus (M5)
//!
//! In-process pub/sub + persistence ตาม ARCHITECTURE.md §6 — ดู [ADR 0003](../../docs/adr/0003-event-bus-in-process.md)
//! สำหรับเหตุผลที่ยังไม่ใช้ broker ภายนอก (NATS/RabbitMQ)

mod bus;
pub mod catalog;

pub use bus::{EventBus, PublishOptions, SubscriberFn, SubscriberFuture};
pub use orva_data::Event;
