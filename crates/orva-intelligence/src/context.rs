use chrono::{Duration, Utc};
use orva_data::{EventFilter, EventRepository, Pool};
use orva_error::Result;
use uuid::Uuid;

use crate::metric::Metric;

/// Context Engine (ARCHITECTURE.md §9) — คำนวณ metric จาก event log ของ organization
/// ในช่วงเวลาหนึ่ง ๆ ไม่มี state ของตัวเอง อ่านจาก `events` table ตรง ๆ ทุกครั้งที่เรียก
pub struct ContextEngine {
    events: EventRepository,
}

impl ContextEngine {
    pub fn new(pool: Pool) -> Self {
        Self {
            events: EventRepository::new(pool),
        }
    }

    pub async fn compute(
        &self,
        organization_id: Uuid,
        event_type: &str,
        metric: &Metric,
        window_seconds: i32,
    ) -> Result<f64> {
        let since = Utc::now() - Duration::seconds(window_seconds as i64);
        let events = self
            .events
            .list(
                organization_id,
                EventFilter {
                    event_type: Some(event_type),
                    occurred_from: Some(since),
                    ..Default::default()
                },
                10_000,
            )
            .await?;
        Ok(metric.compute(&events))
    }
}
