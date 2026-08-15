use chrono::{DateTime, Utc};
use orva_error::{Error, Result};
use serde_json::Value;
use sqlx::{Postgres, QueryBuilder};
use uuid::Uuid;

use crate::{
    entity::Event,
    pool::{begin_tenant, Pool},
};

/// พารามิเตอร์ optional ของ [`EventRepository::append`] — รวมเป็น struct เดียวแทนการรับ
/// parameter แยกกันหลายตัว (clippy::too_many_arguments) เหมือนที่ทำกับ `jwt::IdTokenSubject`
#[derive(Default)]
pub struct AppendOptions {
    pub actor_user_id: Option<Uuid>,
    pub correlation_id: Option<Uuid>,
    pub resource_type: Option<String>,
    pub resource_id: Option<Uuid>,
}

/// Filter สำหรับ audit query (M6) — ทุก field เป็น optional, ไม่ระบุ = ไม่กรอง
#[derive(Default)]
pub struct EventFilter<'a> {
    pub event_type: Option<&'a str>,
    pub actor_user_id: Option<Uuid>,
    pub resource_type: Option<&'a str>,
    pub resource_id: Option<Uuid>,
    pub occurred_from: Option<DateTime<Utc>>,
    pub occurred_to: Option<DateTime<Utc>>,
}

#[derive(Clone)]
pub struct EventRepository {
    pool: Pool,
}

impl EventRepository {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    /// append-only — ไม่มี update/soft_delete (ดู ARCHITECTURE.md §6)
    pub async fn append(
        &self,
        organization_id: Uuid,
        event_type: &str,
        payload: Value,
        options: AppendOptions,
    ) -> Result<Event> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let event = sqlx::query_as::<_, Event>(
            "insert into events
                (organization_id, event_type, payload, actor_user_id, correlation_id, resource_type, resource_id)
             values ($1, $2, $3, $4, $5, $6, $7) returning *",
        )
        .bind(organization_id)
        .bind(event_type)
        .bind(payload)
        .bind(options.actor_user_id)
        .bind(options.correlation_id.unwrap_or_else(Uuid::new_v4))
        .bind(options.resource_type)
        .bind(options.resource_id)
        .fetch_one(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("append event failed: {e}")))?;
        ttx.commit().await?;
        Ok(event)
    }

    pub async fn find_by_id(&self, organization_id: Uuid, id: Uuid) -> Result<Option<Event>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let event = sqlx::query_as::<_, Event>(
            "select * from events where organization_id = $1 and id = $2",
        )
        .bind(organization_id)
        .bind(id)
        .fetch_optional(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("find event failed: {e}")))?;
        ttx.commit().await?;
        Ok(event)
    }

    /// Audit query (M6) — กรองด้วย event_type/actor/resource/ช่วงเวลา ผสมกันได้ตามต้องการ
    /// เรียงล่าสุดก่อนเสมอ
    pub async fn list(
        &self,
        organization_id: Uuid,
        filter: EventFilter<'_>,
        limit: i64,
    ) -> Result<Vec<Event>> {
        let mut query =
            QueryBuilder::<Postgres>::new("select * from events where organization_id = ");
        query.push_bind(organization_id);

        if let Some(event_type) = filter.event_type {
            query.push(" and event_type = ").push_bind(event_type);
        }
        if let Some(actor_user_id) = filter.actor_user_id {
            query.push(" and actor_user_id = ").push_bind(actor_user_id);
        }
        if let Some(resource_type) = filter.resource_type {
            query.push(" and resource_type = ").push_bind(resource_type);
        }
        if let Some(resource_id) = filter.resource_id {
            query.push(" and resource_id = ").push_bind(resource_id);
        }
        if let Some(from) = filter.occurred_from {
            query.push(" and occurred_at >= ").push_bind(from);
        }
        if let Some(to) = filter.occurred_to {
            query.push(" and occurred_at <= ").push_bind(to);
        }

        query
            .push(" order by occurred_at desc limit ")
            .push_bind(limit);

        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let events = query
            .build_query_as::<Event>()
            .fetch_all(ttx.as_executor())
            .await
            .map_err(|e| Error::Internal(format!("list events failed: {e}")))?;
        ttx.commit().await?;
        Ok(events)
    }

    pub async fn list_by_correlation(
        &self,
        organization_id: Uuid,
        correlation_id: Uuid,
    ) -> Result<Vec<Event>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let events = sqlx::query_as::<_, Event>(
            "select * from events where organization_id = $1 and correlation_id = $2
             order by occurred_at",
        )
        .bind(organization_id)
        .bind(correlation_id)
        .fetch_all(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("list events by correlation failed: {e}")))?;
        ttx.commit().await?;
        Ok(events)
    }
}
