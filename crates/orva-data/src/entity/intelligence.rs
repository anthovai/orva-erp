use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
pub struct IntelligenceRule {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub name: String,
    pub event_type: String,
    pub metric: String,
    pub window_seconds: i32,
    pub operator: String,
    pub threshold: f64,
    pub notify_user_id: Option<Uuid>,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub created_by: Option<Uuid>,
}

/// append-only เหมือน [`crate::Event`] (ARCHITECTURE.md §9)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
pub struct Insight {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub rule_id: Uuid,
    pub rule_name: String,
    pub title: String,
    pub description: String,
    pub metric_value: f64,
    pub threshold: f64,
    pub triggered_event_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}
