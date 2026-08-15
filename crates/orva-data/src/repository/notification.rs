use chrono::Utc;
use orva_error::{Error, Result};
use uuid::Uuid;

use crate::{
    entity::{Notification, NotificationPreference},
    pool::Pool,
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
        sqlx::query_as::<_, Notification>(
            "insert into notifications (organization_id, user_id, channel, title, body)
             values ($1, $2, $3, $4, $5) returning *",
        )
        .bind(organization_id)
        .bind(user_id)
        .bind(channel)
        .bind(title)
        .bind(body)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("create notification failed: {e}")))
    }

    pub async fn list_for_user(
        &self,
        organization_id: Uuid,
        user_id: Uuid,
        unread_only: bool,
    ) -> Result<Vec<Notification>> {
        if unread_only {
            sqlx::query_as::<_, Notification>(
                "select * from notifications
                 where organization_id = $1 and user_id = $2 and read_at is null
                 order by created_at desc",
            )
            .bind(organization_id)
            .bind(user_id)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| Error::Internal(format!("list notifications failed: {e}")))
        } else {
            sqlx::query_as::<_, Notification>(
                "select * from notifications
                 where organization_id = $1 and user_id = $2
                 order by created_at desc",
            )
            .bind(organization_id)
            .bind(user_id)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| Error::Internal(format!("list notifications failed: {e}")))
        }
    }

    /// mark-read เฉพาะของ user คนนั้นเอง (`user_id = $3`) — กันคนอื่นมา mark ของคนอื่น
    pub async fn mark_read(&self, organization_id: Uuid, id: Uuid, user_id: Uuid) -> Result<()> {
        sqlx::query(
            "update notifications set read_at = $1
             where organization_id = $2 and id = $3 and user_id = $4",
        )
        .bind(Utc::now())
        .bind(organization_id)
        .bind(id)
        .bind(user_id)
        .execute(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("mark notification read failed: {e}")))?;
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
        let pref = sqlx::query_as::<_, NotificationPreference>(
            "select * from notification_preferences
             where organization_id = $1 and user_id = $2 and channel = $3",
        )
        .bind(organization_id)
        .bind(user_id)
        .bind(channel)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("read notification preference failed: {e}")))?;

        Ok(pref.map(|p| p.enabled).unwrap_or(true))
    }

    pub async fn set(
        &self,
        organization_id: Uuid,
        user_id: Uuid,
        channel: &str,
        enabled: bool,
    ) -> Result<NotificationPreference> {
        sqlx::query_as::<_, NotificationPreference>(
            "insert into notification_preferences (organization_id, user_id, channel, enabled)
             values ($1, $2, $3, $4)
             on conflict (user_id, channel) do update set enabled = excluded.enabled, updated_at = now()
             returning *",
        )
        .bind(organization_id)
        .bind(user_id)
        .bind(channel)
        .bind(enabled)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("set notification preference failed: {e}")))
    }
}
