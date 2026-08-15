use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Open,
    InProgress,
    Done,
}

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskStatus::Open => "open",
            TaskStatus::InProgress => "in_progress",
            TaskStatus::Done => "done",
        }
    }
}

impl std::str::FromStr for TaskStatus {
    type Err = orva_error::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "open" => Ok(TaskStatus::Open),
            "in_progress" => Ok(TaskStatus::InProgress),
            "done" => Ok(TaskStatus::Done),
            other => Err(orva_error::Error::Validation(format!(
                "unknown task status: {other}"
            ))),
        }
    }
}

/// `status` เก็บเป็น `text` ในฐานข้อมูล — ใช้ [`TaskStatus`] ที่ชั้น domain ผ่าน [`Task::status`]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, sqlx::FromRow)]
pub struct Task {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub title: String,
    #[sqlx(rename = "status")]
    pub status_raw: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
    pub created_by: Option<Uuid>,
}

impl Task {
    pub fn status(&self) -> orva_error::Result<TaskStatus> {
        self.status_raw.parse()
    }
}
