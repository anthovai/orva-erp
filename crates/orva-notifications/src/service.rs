use orva_data::{Notification, NotificationPreferenceRepository, NotificationRepository, Pool};
use orva_error::Result;
use uuid::Uuid;

/// Channel แรกของ v0.1 (MILESTONES.md M6) — ช่องทางอื่นเป็น extension ในอนาคต
pub const CHANNEL_IN_APP: &str = "in_app";
pub const CHANNEL_EMAIL: &str = "email";

pub struct NotificationService {
    notifications: NotificationRepository,
    preferences: NotificationPreferenceRepository,
}

impl NotificationService {
    pub fn new(pool: Pool) -> Self {
        Self {
            notifications: NotificationRepository::new(pool.clone()),
            preferences: NotificationPreferenceRepository::new(pool),
        }
    }

    /// สร้าง notification ทุก channel ที่ user เปิดรับ (ไม่มี preference row = เปิดรับ
    /// ทุก channel เป็น default — opt-out model)
    ///
    /// **หมายเหตุ (v0.1 known gap):** channel `email` แค่บันทึกแถวลง `notifications`
    /// ไม่มีการส่งอีเมลจริงผ่าน SMTP — ดู MILESTONES.md M6
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
                self.notifications
                    .create(organization_id, user_id, channel, title, body)
                    .await?;

                if channel == CHANNEL_EMAIL {
                    tracing::info!(
                        organization_id = %organization_id,
                        user_id = %user_id,
                        "email notification queued (no SMTP client wired in v0.1 — see MILESTONES.md M6)"
                    );
                }
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
