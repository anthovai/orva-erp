//! Real-time push ของ in-app notification (ADR 0013) — in-process broadcast
//! ที่ SSE endpoint ของ core subscribe (สอดคล้อง ADR 0003: ยังไม่มี broker ภายนอก)

use orva_data::Notification;
use tokio::sync::broadcast;

/// จำนวน notification ที่ค้างใน channel ได้ก่อน subscriber ช้าเริ่มพลาด message
/// (SSE เป็น "best effort" — แหล่งความจริงคือตาราง `notifications` เสมอ
/// client ที่หลุด/พลาดใช้ `GET /api/v1/notifications` sync กลับมาได้)
const CHANNEL_CAPACITY: usize = 256;

#[derive(Clone)]
pub struct NotificationHub {
    sender: broadcast::Sender<Notification>,
}

impl Default for NotificationHub {
    fn default() -> Self {
        Self::new()
    }
}

impl NotificationHub {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(CHANNEL_CAPACITY);
        Self { sender }
    }

    /// broadcast ให้ทุก subscriber — ไม่มีใครฟังอยู่ = no-op (ไม่ใช่ error)
    pub fn publish(&self, notification: Notification) {
        let _ = self.sender.send(notification);
    }

    /// subscriber ใหม่เห็นเฉพาะ notification ที่เกิด**หลัง** subscribe — ของเก่า
    /// อ่านจากตาราง `notifications` ตามปกติ
    pub fn subscribe(&self) -> broadcast::Receiver<Notification> {
        self.sender.subscribe()
    }
}
