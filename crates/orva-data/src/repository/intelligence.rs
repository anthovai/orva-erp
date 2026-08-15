use orva_error::{Error, Result};
use uuid::Uuid;

use crate::{
    entity::{Insight, IntelligenceRule, Recommendation},
    pool::{begin_tenant, Pool},
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
    /// action ที่จะแนะนำเมื่อ rule trigger (ADR 0010) — สร้าง Recommendation อัตโนมัติ
    pub recommended_action: Option<serde_json::Value>,
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
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let rule = sqlx::query_as::<_, IntelligenceRule>(
            "insert into intelligence_rules
                (organization_id, name, event_type, metric, window_seconds, operator, threshold, notify_user_id, created_by, recommended_action)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *",
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
        .bind(params.recommended_action)
        .fetch_one(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("create intelligence rule failed: {e}")))?;
        ttx.commit().await?;
        Ok(rule)
    }

    pub async fn list(&self, organization_id: Uuid) -> Result<Vec<IntelligenceRule>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let rules = sqlx::query_as::<_, IntelligenceRule>(
            "select * from intelligence_rules where organization_id = $1 order by created_at",
        )
        .bind(organization_id)
        .fetch_all(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("list intelligence rules failed: {e}")))?;
        ttx.commit().await?;
        Ok(rules)
    }

    /// ดึง rule ที่เปิดใช้งานและผูกกับ event_type นี้ — เรียกทุกครั้งที่มี event เข้ามา
    /// (ดู `orva_intelligence::IntelligenceEngine`)
    pub async fn list_enabled_for_event_type(
        &self,
        organization_id: Uuid,
        event_type: &str,
    ) -> Result<Vec<IntelligenceRule>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let rules = sqlx::query_as::<_, IntelligenceRule>(
            "select * from intelligence_rules
             where organization_id = $1 and event_type = $2 and enabled = true",
        )
        .bind(organization_id)
        .bind(event_type)
        .fetch_all(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("list enabled intelligence rules failed: {e}")))?;
        ttx.commit().await?;
        Ok(rules)
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
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let insight = sqlx::query_as::<_, Insight>(
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
        .fetch_one(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("create insight failed: {e}")))?;
        ttx.commit().await?;
        Ok(insight)
    }

    pub async fn list(&self, organization_id: Uuid, limit: i64) -> Result<Vec<Insight>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let insights = sqlx::query_as::<_, Insight>(
            "select * from insights where organization_id = $1 order by created_at desc limit $2",
        )
        .bind(organization_id)
        .bind(limit)
        .fetch_all(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("list insights failed: {e}")))?;
        ttx.commit().await?;
        Ok(insights)
    }
}

#[derive(Clone)]
pub struct RecommendationRepository {
    pool: Pool,
}

pub struct CreateRecommendationParams<'a> {
    pub insight_id: Uuid,
    pub rule_id: Uuid,
    pub title: &'a str,
    pub description: &'a str,
    pub suggested_action: Option<serde_json::Value>,
}

impl RecommendationRepository {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    pub async fn create(
        &self,
        organization_id: Uuid,
        params: CreateRecommendationParams<'_>,
    ) -> Result<Recommendation> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let recommendation = sqlx::query_as::<_, Recommendation>(
            "insert into recommendations
                (organization_id, insight_id, rule_id, title, description, suggested_action)
             values ($1, $2, $3, $4, $5, $6) returning *",
        )
        .bind(organization_id)
        .bind(params.insight_id)
        .bind(params.rule_id)
        .bind(params.title)
        .bind(params.description)
        .bind(params.suggested_action)
        .fetch_one(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("create recommendation failed: {e}")))?;
        ttx.commit().await?;
        Ok(recommendation)
    }

    pub async fn find_by_id(
        &self,
        organization_id: Uuid,
        id: Uuid,
    ) -> Result<Option<Recommendation>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let recommendation = sqlx::query_as::<_, Recommendation>(
            "select * from recommendations where organization_id = $1 and id = $2",
        )
        .bind(organization_id)
        .bind(id)
        .fetch_optional(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("find recommendation failed: {e}")))?;
        ttx.commit().await?;
        Ok(recommendation)
    }

    /// ล่าสุดก่อน — `status` = `None` คือทุกสถานะ
    pub async fn list(
        &self,
        organization_id: Uuid,
        status: Option<&str>,
        limit: i64,
    ) -> Result<Vec<Recommendation>> {
        let sql = match status {
            Some(_) => {
                "select * from recommendations
                 where organization_id = $1 and status = $2
                 order by created_at desc limit $3"
            }
            None => {
                "select * from recommendations
                 where organization_id = $1 and ($2::text is null or true)
                 order by created_at desc limit $3"
            }
        };
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let recommendations = sqlx::query_as::<_, Recommendation>(sql)
            .bind(organization_id)
            .bind(status)
            .bind(limit)
            .fetch_all(ttx.as_executor())
            .await
            .map_err(|e| Error::Internal(format!("list recommendations failed: {e}")))?;
        ttx.commit().await?;
        Ok(recommendations)
    }

    /// บันทึกการตัดสินใจ — ทำได้ครั้งเดียว (แถวที่ไม่ pending แล้วไม่ถูกแตะ, คืน None)
    pub async fn decide(
        &self,
        organization_id: Uuid,
        id: Uuid,
        decided_by: Uuid,
        status: &str,
        resulting_workflow_id: Option<Uuid>,
    ) -> Result<Option<Recommendation>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let recommendation = sqlx::query_as::<_, Recommendation>(
            "update recommendations
             set status = $1, decided_by = $2, decided_at = now(), resulting_workflow_id = $3
             where organization_id = $4 and id = $5 and status = 'pending'
             returning *",
        )
        .bind(status)
        .bind(decided_by)
        .bind(resulting_workflow_id)
        .bind(organization_id)
        .bind(id)
        .fetch_optional(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("decide recommendation failed: {e}")))?;
        ttx.commit().await?;
        Ok(recommendation)
    }
}
