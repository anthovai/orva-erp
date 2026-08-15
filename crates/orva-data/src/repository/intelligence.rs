use orva_error::{Error, Result};
use uuid::Uuid;

use crate::{
    entity::{Insight, IntelligenceRule},
    pool::Pool,
};

#[derive(Clone)]
pub struct IntelligenceRuleRepository {
    pool: Pool,
}

/// พารามิเตอร์สร้าง rule — รวมเป็น struct เดียว (clippy::too_many_arguments)
pub struct CreateRuleParams<'a> {
    pub name: &'a str,
    pub event_type: &'a str,
    pub metric: &'a str,
    pub window_seconds: i32,
    pub operator: &'a str,
    pub threshold: f64,
    pub notify_user_id: Option<Uuid>,
}

impl IntelligenceRuleRepository {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    pub async fn create(
        &self,
        organization_id: Uuid,
        params: CreateRuleParams<'_>,
        created_by: Uuid,
    ) -> Result<IntelligenceRule> {
        sqlx::query_as::<_, IntelligenceRule>(
            "insert into intelligence_rules
                (organization_id, name, event_type, metric, window_seconds, operator, threshold, notify_user_id, created_by)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *",
        )
        .bind(organization_id)
        .bind(params.name)
        .bind(params.event_type)
        .bind(params.metric)
        .bind(params.window_seconds)
        .bind(params.operator)
        .bind(params.threshold)
        .bind(params.notify_user_id)
        .bind(created_by)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("create intelligence rule failed: {e}")))
    }

    pub async fn list(&self, organization_id: Uuid) -> Result<Vec<IntelligenceRule>> {
        sqlx::query_as::<_, IntelligenceRule>(
            "select * from intelligence_rules where organization_id = $1 order by created_at",
        )
        .bind(organization_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("list intelligence rules failed: {e}")))
    }

    /// ดึง rule ที่เปิดใช้งานและผูกกับ event_type นี้ — เรียกทุกครั้งที่มี event เข้ามา
    /// (ดู `orva_intelligence::IntelligenceEngine`)
    pub async fn list_enabled_for_event_type(
        &self,
        organization_id: Uuid,
        event_type: &str,
    ) -> Result<Vec<IntelligenceRule>> {
        sqlx::query_as::<_, IntelligenceRule>(
            "select * from intelligence_rules
             where organization_id = $1 and event_type = $2 and enabled = true",
        )
        .bind(organization_id)
        .bind(event_type)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("list enabled intelligence rules failed: {e}")))
    }
}

#[derive(Clone)]
pub struct InsightRepository {
    pool: Pool,
}

pub struct CreateInsightParams<'a> {
    pub rule_id: Uuid,
    pub rule_name: &'a str,
    pub title: &'a str,
    pub description: &'a str,
    pub metric_value: f64,
    pub threshold: f64,
    pub triggered_event_id: Option<Uuid>,
}

impl InsightRepository {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    pub async fn create(
        &self,
        organization_id: Uuid,
        params: CreateInsightParams<'_>,
    ) -> Result<Insight> {
        sqlx::query_as::<_, Insight>(
            "insert into insights
                (organization_id, rule_id, rule_name, title, description, metric_value, threshold, triggered_event_id)
             values ($1, $2, $3, $4, $5, $6, $7, $8) returning *",
        )
        .bind(organization_id)
        .bind(params.rule_id)
        .bind(params.rule_name)
        .bind(params.title)
        .bind(params.description)
        .bind(params.metric_value)
        .bind(params.threshold)
        .bind(params.triggered_event_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("create insight failed: {e}")))
    }

    pub async fn list(&self, organization_id: Uuid, limit: i64) -> Result<Vec<Insight>> {
        sqlx::query_as::<_, Insight>(
            "select * from insights where organization_id = $1 order by created_at desc limit $2",
        )
        .bind(organization_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("list insights failed: {e}")))
    }
}
