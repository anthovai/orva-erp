use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
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
