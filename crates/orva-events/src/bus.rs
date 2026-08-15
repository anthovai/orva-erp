use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, RwLock};

use orva_data::{AppendOptions, Event, EventRepository, Pool};
use orva_error::Result;
use serde_json::Value;
use uuid::Uuid;

/// จำนวนครั้งที่ retry ต่อ subscriber ก่อนยอมแพ้ (v0.1: fixed, ไม่มี backoff จริง — ดู MILESTONES.md M5)
const MAX_SUBSCRIBER_RETRIES: u32 = 3;

pub type SubscriberFuture = Pin<Box<dyn Future<Output = Result<()>> + Send>>;
pub type SubscriberFn = Arc<dyn Fn(Event) -> SubscriberFuture + Send + Sync>;

/// พารามิเตอร์ optional ของ [`EventBus::publish`] — รวมเป็น struct เดียวกันแบบเดียวกับ
/// `orva_data::AppendOptions` (clippy::too_many_arguments)
#[derive(Default)]
pub struct PublishOptions {
    pub actor_user_id: Option<Uuid>,
    pub correlation_id: Option<Uuid>,
    /// (resource_type, resource_id) — เติมเฉพาะ event ที่ผูกกับ resource ชัดเจน (audit trail, M6)
    pub resource: Option<(String, Uuid)>,
}

/// ORVA Event Bus (M5) — in-process pub/sub + persistence
///
/// ทุก event ที่ publish จะถูก persist ลง `events` table **ก่อน** แจ้ง subscriber เสมอ
/// (ดู ARCHITECTURE.md §6) ดังนั้นต่อให้ subscriber ทั้งหมด fail หลัง retry ครบ event ก็ยัง
/// อยู่ใน log ให้ query ย้อนหลังหรือ replay ทีหลังได้ — ไม่มี event ไหนหายเพราะ subscriber พัง
#[derive(Clone)]
pub struct EventBus {
    store: EventRepository,
    subscribers: Arc<RwLock<HashMap<String, Vec<SubscriberFn>>>>,
    wildcard_subscribers: Arc<RwLock<Vec<SubscriberFn>>>,
}

impl EventBus {
    pub fn new(pool: Pool) -> Self {
        Self {
            store: EventRepository::new(pool),
            subscribers: Arc::new(RwLock::new(HashMap::new())),
            wildcard_subscribers: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// ฟังเฉพาะ event_type ที่ระบุ
    pub fn subscribe(&self, event_type: &str, handler: SubscriberFn) {
        self.subscribers
            .write()
            .expect("event bus subscribers lock poisoned")
            .entry(event_type.to_string())
            .or_default()
            .push(handler);
    }

    /// ฟังทุก event ไม่ว่า type ไหน — ใช้กับ Audit Log (M6) / Intelligence Context Engine (M8) ในอนาคต
    pub fn subscribe_all(&self, handler: SubscriberFn) {
        self.wildcard_subscribers
            .write()
            .expect("event bus wildcard subscribers lock poisoned")
            .push(handler);
    }

    /// Persist แล้วแจ้ง subscriber ที่ตรง `event_type` และ wildcard subscriber ทั้งหมด
    /// ตามลำดับ (synchronous dispatch — subscriber ช้าจะหน่วง publish รอ v0.1 เท่านั้น)
    pub async fn publish(
        &self,
        organization_id: Uuid,
        event_type: &str,
        payload: Value,
        options: PublishOptions,
    ) -> Result<Event> {
        let (resource_type, resource_id) = match options.resource {
            Some((rt, rid)) => (Some(rt), Some(rid)),
            None => (None, None),
        };

        let event = self
            .store
            .append(
                organization_id,
                event_type,
                payload,
                AppendOptions {
                    actor_user_id: options.actor_user_id,
                    correlation_id: options.correlation_id,
                    resource_type,
                    resource_id,
                },
            )
            .await?;

        let handlers: Vec<SubscriberFn> = {
            let by_type = self
                .subscribers
                .read()
                .expect("event bus subscribers lock poisoned");
            let wildcard = self
                .wildcard_subscribers
                .read()
                .expect("event bus wildcard subscribers lock poisoned");

            by_type
                .get(event_type)
                .into_iter()
                .flatten()
                .chain(wildcard.iter())
                .cloned()
                .collect()
        };

        for handler in handlers {
            dispatch_with_retry(&handler, event.clone()).await;
        }

        Ok(event)
    }
}

async fn dispatch_with_retry(handler: &SubscriberFn, event: Event) {
    for attempt in 1..=MAX_SUBSCRIBER_RETRIES {
        match handler(event.clone()).await {
            Ok(()) => return,
            Err(e) if attempt < MAX_SUBSCRIBER_RETRIES => {
                tracing::warn!(
                    event_type = %event.event_type,
                    event_id = %event.id,
                    attempt,
                    error = %e,
                    "event subscriber failed — retrying"
                );
            }
            Err(e) => {
                tracing::error!(
                    event_type = %event.event_type,
                    event_id = %event.id,
                    error = %e,
                    "event subscriber failed permanently after {MAX_SUBSCRIBER_RETRIES} attempts — event remains in log"
                );
            }
        }
    }
}
