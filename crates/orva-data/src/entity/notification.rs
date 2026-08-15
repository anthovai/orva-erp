use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
pub struct Notification {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub user_id: Uuid,
    pub channel: String,
    pub title: String,
    pub body: String,
    pub read_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    /// `created` | `sent` | `failed` — ดู migration `notification_delivery`
    pub delivery_status: String,
    pub delivered_at: Option<DateTime<Utc>>,
    pub delivery_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
pub struct NotificationPreference {
    pub organization_id: Uuid,
    pub user_id: Uuid,
    pub channel: String,
    pub enabled: bool,
    pub updated_at: DateTime<Utc>,
}
