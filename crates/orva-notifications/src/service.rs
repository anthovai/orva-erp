use std::sync::Arc;

use orva_data::{
    Notification, NotificationPreferenceRepository, NotificationRepository, Pool, UserRepository,
};
use orva_error::Result;
use uuid::Uuid;

use crate::mailer::{EmailMessage, Mailer};

/// Channel แรกของ v0.1 (MILESTONES.md M6) — ช่องทางอื่นเป็น extension ในอนาคต
pub const CHANNEL_IN_APP: &str = "in_app";
pub const CHANNEL_EMAIL: &str = "email";

pub struct NotificationService {
    notifications: NotificationRepository,
    preferences: NotificationPreferenceRepository,
    users: UserRepository,
    /// `None` = ไม่ได้ config SMTP — email channel บันทึกแถวไว้เฉย ๆ (พฤติกรรมเดิมของ v0.1)
    mailer: Option<Arc<dyn Mailer>>,
}

impl NotificationService {
    pub fn new(pool: Pool) -> Self {
        Self::with_mailer(pool, None)
    }

    pub fn with_mailer(pool: Pool, mailer: Option<Arc<dyn Mailer>>) -> Self {
        Self {
            notifications: NotificationRepository::new(pool.clone()),
            preferences: NotificationPreferenceRepository::new(pool.clone()),
            users: UserRepository::new(pool),
            mailer,
        }
    }

    /// สร้าง notification ทุก channel ที่ user เปิดรับ (ไม่มี preference row = เปิดรับ
    /// ทุก channel เป็น default — opt-out model)
    ///
    /// channel `email` ส่งจริงทาง SMTP เมื่อ config mailer ไว้ (ADR 0008) —
    /// การส่งล้มเหลว**ไม่ทำให้ notify ล้มเหลว** (แถว in_app/email บันทึกไปแล้ว)
    /// แค่ mark `delivery_status = 'failed'` พร้อมเหตุผลไว้ให้ตรวจ
    pub async fn notify(
        &self,
        organization_id: Uuid,
        user_id: Uuid,
        title: &str,
        body: &str,
    ) -> Result<()> {
        for channel in [CHANNEL_IN_APP, CHANNEL_EMAIL] {
            if self
                .preferences
                .is_enabled(organization_id, user_id, channel)
                .await?
            {
                let notification = self
                    .notifications
                    .create(organization_id, user_id, channel, title, body)
                    .await?;

                if channel == CHANNEL_EMAIL {
                    self.deliver_email(&notification).await?;
                }
            }
        }
        Ok(())
    }

    async fn deliver_email(&self, notification: &Notification) -> Result<()> {
        let Some(mailer) = &self.mailer else {
            tracing::info!(
                notification_id = %notification.id,
                "email notification recorded but not sent (no SMTP configured — see ADR 0008)"
            );
            return Ok(());
        };

        let Some(user) = self
            .users
            .find_by_id(notification.organization_id, notification.user_id)
            .await?
        else {
            self.notifications
                .set_delivery_status(
                    notification.organization_id,
                    notification.id,
                    "failed",
                    Some("recipient user not found"),
                )
                .await?;
            return Ok(());
        };

        let result = mailer
            .send(EmailMessage {
                to: user.email.clone(),
                subject: notification.title.clone(),
                body: notification.body.clone(),
            })
            .await;

        match result {
            Ok(()) => {
                self.notifications
                    .set_delivery_status(
                        notification.organization_id,
                        notification.id,
                        "sent",
                        None,
                    )
                    .await?;
            }
            Err(e) => {
                tracing::warn!(
                    notification_id = %notification.id,
                    error = %e,
                    "email delivery failed"
                );
                self.notifications
                    .set_delivery_status(
                        notification.organization_id,
                        notification.id,
                        "failed",
                        Some(&e.to_string()),
                    )
                    .await?;
            }
        }
        Ok(())
    }

    pub async fn list_for_user(
        &self,
        organization_id: Uuid,
        user_id: Uuid,
        unread_only: bool,
    ) -> Result<Vec<Notification>> {
        self.notifications
            .list_for_user(organization_id, user_id, unread_only)
            .await
    }

    pub async fn mark_read(&self, organization_id: Uuid, id: Uuid, user_id: Uuid) -> Result<()> {
        self.notifications
            .mark_read(organization_id, id, user_id)
            .await
    }

    pub async fn set_preference(
        &self,
        organization_id: Uuid,
        user_id: Uuid,
        channel: &str,
        enabled: bool,
    ) -> Result<()> {
        self.preferences
            .set(organization_id, user_id, channel, enabled)
            .await?;
        Ok(())
    }
}
