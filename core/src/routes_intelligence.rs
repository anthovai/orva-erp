use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{
    error::ApiError,
    extractor::RequirePermission,
    permissions::{InsightRead, IntelligenceManage},
    state::AppState,
};

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/intelligence/rules",
            post(create_rule).get(list_rules),
        )
        .route("/api/v1/insights", get(list_insights))
        .route("/api/v1/recommendations", get(list_recommendations))
        .route(
            "/api/v1/recommendations/{id}/accept",
            post(accept_recommendation),
        )
        .route(
            "/api/v1/recommendations/{id}/dismiss",
            post(dismiss_recommendation),
        )
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct CreateRuleRequest {
    name: String,
    /// event type ที่จะฟัง เช่น `role.created`, `service_identity.issued`
    event_type: String,
    /// `count` หรือ `sum:<field>` (เช่น `sum:amount`)
    #[serde(default = "default_metric")]
    metric: String,
    window_seconds: i32,
    /// gt/gte/lt/lte/eq
    operator: String,
    threshold: f64,
    notify_user_id: Option<Uuid>,
    /// action ที่จะแนะนำเมื่อ rule trigger (ADR 0010) — เช่น
    /// `{"type":"workflow","definition_id":"..."}` ทำให้ engine สร้าง Recommendation อัตโนมัติ
    recommended_action: Option<Value>,
}

fn default_metric() -> String {
    "count".to_string()
}

#[derive(Serialize, ToSchema)]
pub(crate) struct RuleResponse {
    id: Uuid,
    name: String,
    event_type: String,
    metric: String,
    window_seconds: i32,
    operator: String,
    threshold: f64,
    enabled: bool,
}

impl From<orva_data::IntelligenceRule> for RuleResponse {
    fn from(r: orva_data::IntelligenceRule) -> Self {
        Self {
            id: r.id,
            name: r.name,
            event_type: r.event_type,
            metric: r.metric,
            window_seconds: r.window_seconds,
            operator: r.operator,
            threshold: r.threshold,
            enabled: r.enabled,
        }
    }
}

/// สร้าง intelligence rule (M8) — ประเมินทันทีที่ event ตรง `event_type` เกิดขึ้นจริง
/// ไม่มี scheduler ผลัดให้ทีหลัง
#[utoipa::path(post, path = "/api/v1/intelligence/rules", tag = "intelligence",
    security(("bearer" = [])),
    request_body = CreateRuleRequest,
    responses((status = 201, description = "Rule created", body = RuleResponse)))]
pub(crate) async fn create_rule(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<IntelligenceManage>,
    Json(body): Json<CreateRuleRequest>,
) -> Result<(StatusCode, Json<RuleResponse>), ApiError> {
    let rule = state
        .intelligence_rules
        .create(
            user.organization_id,
            orva_data::CreateRuleParams {
                name: &body.name,
                event_type: &body.event_type,
                metric: &body.metric,
                window_seconds: body.window_seconds,
                operator: &body.operator,
                threshold: body.threshold,
                notify_user_id: body.notify_user_id,
                recommended_action: body.recommended_action,
            },
            user.id,
        )
        .await?;
    Ok((StatusCode::CREATED, Json(rule.into())))
}

#[utoipa::path(get, path = "/api/v1/intelligence/rules", tag = "intelligence",
    security(("bearer" = [])),
    responses((status = 200, description = "Rule ทั้งหมดขององค์กร", body = [RuleResponse])))]
pub(crate) async fn list_rules(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<IntelligenceManage>,
) -> Result<Json<Vec<RuleResponse>>, ApiError> {
    let rules = state.intelligence_rules.list(user.organization_id).await?;
    Ok(Json(rules.into_iter().map(RuleResponse::from).collect()))
}

#[derive(Serialize, ToSchema)]
pub(crate) struct InsightResponse {
    id: Uuid,
    rule_id: Uuid,
    rule_name: String,
    title: String,
    description: String,
    metric_value: f64,
    threshold: f64,
    created_at: DateTime<Utc>,
}

impl From<orva_data::Insight> for InsightResponse {
    fn from(i: orva_data::Insight) -> Self {
        Self {
            id: i.id,
            rule_id: i.rule_id,
            rule_name: i.rule_name,
            title: i.title,
            description: i.description,
            metric_value: i.metric_value,
            threshold: i.threshold,
            created_at: i.created_at,
        }
    }
}

/// M8 DoD: "มี insight เกิดจาก rule จริง" — endpoint นี้คือทางเข้า query ผ่าน API จริง
#[utoipa::path(get, path = "/api/v1/insights", tag = "intelligence",
    security(("bearer" = [])),
    responses((status = 200, description = "Insight ล่าสุดก่อนขององค์กร", body = [InsightResponse])))]
pub(crate) async fn list_insights(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<InsightRead>,
) -> Result<Json<Vec<InsightResponse>>, ApiError> {
    let insights = state.insights.list(user.organization_id, 50).await?;
    Ok(Json(
        insights.into_iter().map(InsightResponse::from).collect(),
    ))
}

#[derive(Serialize, ToSchema)]
pub(crate) struct RecommendationResponse {
    id: Uuid,
    insight_id: Uuid,
    rule_id: Uuid,
    title: String,
    description: String,
    suggested_action: Option<Value>,
    status: String,
    resulting_workflow_id: Option<Uuid>,
    created_at: DateTime<Utc>,
}

impl From<orva_data::Recommendation> for RecommendationResponse {
    fn from(r: orva_data::Recommendation) -> Self {
        Self {
            id: r.id,
            insight_id: r.insight_id,
            rule_id: r.rule_id,
            title: r.title,
            description: r.description,
            suggested_action: r.suggested_action,
            status: r.status,
            resulting_workflow_id: r.resulting_workflow_id,
            created_at: r.created_at,
        }
    }
}

#[derive(Deserialize, IntoParams)]
pub(crate) struct RecommendationFilter {
    /// pending | accepted | dismissed — ไม่ระบุ = ทุกสถานะ
    status: Option<String>,
}

#[utoipa::path(get, path = "/api/v1/recommendations", tag = "intelligence",
    security(("bearer" = [])), params(RecommendationFilter),
    responses((status = 200, description = "Recommendation ล่าสุดก่อนขององค์กร", body = [RecommendationResponse])))]
pub(crate) async fn list_recommendations(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<InsightRead>,
    Query(filter): Query<RecommendationFilter>,
) -> Result<Json<Vec<RecommendationResponse>>, ApiError> {
    let recommendations = state
        .recommendations
        .list(user.organization_id, filter.status.as_deref(), 50)
        .await?;
    Ok(Json(
        recommendations
            .into_iter()
            .map(RecommendationResponse::from)
            .collect(),
    ))
}

/// Accept recommendation (ADR 0010) — ถ้า `suggested_action` เป็น
/// `{"type":"workflow","definition_id":"..."}` จะสร้าง workflow instance จาก definition
/// นั้นให้เลย (resource = ตัว recommendation เอง) — action จึงยังผ่านขั้น approval
/// ของ Workflow Engine ตามปกติ ไม่ใช่ execute ตรง ๆ
#[utoipa::path(post, path = "/api/v1/recommendations/{id}/accept", tag = "intelligence",
    security(("bearer" = [])), params(("id" = Uuid, Path)),
    responses((status = 200, description = "Accepted — workflow created when action is a workflow", body = RecommendationResponse),
               (status = 400, description = "Already decided"),
               (status = 404, description = "Not found in caller's organization")))]
pub(crate) async fn accept_recommendation(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<IntelligenceManage>,
    Path(id): Path<Uuid>,
) -> Result<Json<RecommendationResponse>, ApiError> {
    let recommendation = state
        .recommendations
        .find_by_id(user.organization_id, id)
        .await?
        .ok_or_else(|| orva_error::Error::NotFound(format!("recommendation '{id}'")))?;

    // interpret suggested_action ที่ชั้น core (intelligence layer ไม่ execute อะไรเอง)
    let resulting_workflow_id = match &recommendation.suggested_action {
        Some(action) if action["type"] == "workflow" => {
            let definition_id: Uuid = action["definition_id"]
                .as_str()
                .and_then(|s| s.parse().ok())
                .ok_or_else(|| {
                    orva_error::Error::Validation(
                        "suggested_action.definition_id is missing or invalid".to_string(),
                    )
                })?;
            let instance = state
                .workflow
                .create_from_definition(
                    user.organization_id,
                    definition_id,
                    recommendation.id,
                    action
                        .get("context")
                        .cloned()
                        .unwrap_or_else(|| serde_json::json!({})),
                    Some(user.id),
                )
                .await?;
            Some(instance.id)
        }
        _ => None,
    };

    let updated = state
        .recommendations
        .decide(
            user.organization_id,
            id,
            user.id,
            "accepted",
            resulting_workflow_id,
        )
        .await?
        .ok_or_else(|| {
            orva_error::Error::Validation("recommendation already decided".to_string())
        })?;

    state
        .event_bus
        .publish(
            user.organization_id,
            orva_events::catalog::RECOMMENDATION_ACCEPTED,
            serde_json::json!({
                "recommendation_id": id,
                "resulting_workflow_id": resulting_workflow_id,
            }),
            orva_events::PublishOptions {
                actor_user_id: Some(user.id),
                resource: Some(("recommendation".to_string(), id)),
                ..Default::default()
            },
        )
        .await?;

    Ok(Json(updated.into()))
}

#[utoipa::path(post, path = "/api/v1/recommendations/{id}/dismiss", tag = "intelligence",
    security(("bearer" = [])), params(("id" = Uuid, Path)),
    responses((status = 200, description = "Dismissed", body = RecommendationResponse),
               (status = 400, description = "Already decided")))]
pub(crate) async fn dismiss_recommendation(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<IntelligenceManage>,
    Path(id): Path<Uuid>,
) -> Result<Json<RecommendationResponse>, ApiError> {
    let updated = state
        .recommendations
        .decide(user.organization_id, id, user.id, "dismissed", None)
        .await?
        .ok_or_else(|| {
            orva_error::Error::Validation("recommendation not found or already decided".to_string())
        })?;

    state
        .event_bus
        .publish(
            user.organization_id,
            orva_events::catalog::RECOMMENDATION_DISMISSED,
            serde_json::json!({ "recommendation_id": id }),
            orva_events::PublishOptions {
                actor_user_id: Some(user.id),
                resource: Some(("recommendation".to_string(), id)),
                ..Default::default()
            },
        )
        .await?;

    Ok(Json(updated.into()))
}
