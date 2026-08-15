use chrono::Utc;
use orva_error::{Error, Result};
use uuid::Uuid;

use crate::{
    entity::{Notification, NotificationPreference},
    pool::{begin_tenant, Pool},
};

#[derive(Clone)]
pub struct NotificationRepository {
    pool: Pool,
}

impl NotificationRepository {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    pub async fn create(
        &self,
        organization_id: Uuid,
        user_id: Uuid,
        channel: &str,
        title: &str,
        body: &str,
    ) -> Result<Notification> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let notification = sqlx::query_as::<_, Notification>(
            "insert into notifications (organization_id, user_id, channel, title, body)
             values ($1, $2, $3, $4, $5) returning *",
        )
        .bind(organization_id)
        .bind(user_id)
        .bind(channel)
        .bind(title)
        .bind(body)
        .fetch_one(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("create notification failed: {e}")))?;
        ttx.commit().await?;
        Ok(notification)
    }

    pub async fn list_for_user(
        &self,
        organization_id: Uuid,
        user_id: Uuid,
        unread_only: bool,
    ) -> Result<Vec<Notification>> {
        let sql = if unread_only {
            "select * from notifications
             where organization_id = $1 and user_id = $2 and read_at is null
             order by created_at desc"
        } else {
            "select * from notifications
             where organization_id = $1 and user_id = $2
             order by created_at desc"
        };
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let notifications = sqlx::query_as::<_, Notification>(sql)
            .bind(organization_id)
            .bind(user_id)
            .fetch_all(ttx.as_executor())
            .await
            .map_err(|e| Error::Internal(format!("list notifications failed: {e}")))?;
        ttx.commit().await?;
        Ok(notifications)
    }

    /// บันทึกผลการส่งจริง (email channel) — `sent` ตั้ง delivered_at, `failed` เก็บ error
    pub async fn set_delivery_status(
        &self,
        organization_id: Uuid,
        id: Uuid,
        status: &str,
        error: Option<&str>,
    ) -> Result<()> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        sqlx::query(
            "update notifications
             set delivery_status = $1,
                 delivered_at = case when $1 = 'sent' then now() end,
                 delivery_error = $2
             where organization_id = $3 and id = $4",
        )
        .bind(status)
        .bind(error)
        .bind(organization_id)
        .bind(id)
        .execute(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("set delivery status failed: {e}")))?;
        ttx.commit().await?;
        Ok(())
    }

    /// mark-read เฉพาะของ user คนนั้นเอง (`user_id = $4`) — กันคนอื่นมา mark ของคนอื่น
    pub async fn mark_read(&self, organization_id: Uuid, id: Uuid, user_id: Uuid) -> Result<()> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        sqlx::query(
            "update notifications set read_at = $1
             where organization_id = $2 and id = $3 and user_id = $4",
        )
        .bind(Utc::now())
        .bind(organization_id)
        .bind(id)
        .bind(user_id)
        .execute(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("mark notification read failed: {e}")))?;
        ttx.commit().await?;
        Ok(())
    }
}

#[derive(Clone)]
pub struct NotificationPreferenceRepository {
    pool: Pool,
}

impl NotificationPreferenceRepository {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    /// ไม่มี row = ถือว่าเปิดรับ (opt-out model) — ดู migration comment
    pub async fn is_enabled(
        &self,
        organization_id: Uuid,
        user_id: Uuid,
        channel: &str,
    ) -> Result<bool> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let pref = sqlx::query_as::<_, NotificationPreference>(
            "select * from notification_preferences
             where organization_id = $1 and user_id = $2 and channel = $3",
        )
        .bind(organization_id)
        .bind(user_id)
        .bind(channel)
        .fetch_optional(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("read notification preference failed: {e}")))?;
        ttx.commit().await?;

        Ok(pref.map(|p| p.enabled).unwrap_or(true))
    }

    pub async fn set(
        &self,
        organization_id: Uuid,
        user_id: Uuid,
        channel: &str,
        enabled: bool,
    ) -> Result<NotificationPreference> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let pref = sqlx::query_as::<_, NotificationPreference>(
            "insert into notification_preferences (organization_id, user_id, channel, enabled)
             values ($1, $2, $3, $4)
             on conflict (user_id, channel) do update set enabled = excluded.enabled, updated_at = now()
             returning *",
        )
        .bind(organization_id)
        .bind(user_id)
        .bind(channel)
        .bind(enabled)
        .fetch_one(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("set notification preference failed: {e}")))?;
        ttx.commit().await?;
        Ok(pref)
    }
}
