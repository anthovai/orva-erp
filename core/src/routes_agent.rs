use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    error::ApiError, extractor::ServiceIdentityAuth, routes_workflow::WorkflowResponse,
    state::AppState,
};

/// ORVA Agent API (M8) — จุดเชื่อมสำหรับ ORVA Worker (OpenWorker) ใน Phase ถัดไป
/// (ARCHITECTURE.md §12) auth ด้วย service identity (`X-Orva-Service-Key`) ไม่ใช่ user session
pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/agent/context", get(context))
        .route("/api/v1/agent/workflows", post(propose_workflow))
        .route("/api/v1/agent/workflows/{id}", get(get_workflow))
}

#[derive(Serialize, ToSchema)]
pub(crate) struct AgentContextResponse {
    service_identity_id: Uuid,
    name: String,
    organization_id: Uuid,
}

/// agent เช็คตัวเอง — เทียบเท่า `/me` ของ user
#[utoipa::path(get, path = "/api/v1/agent/context", tag = "agent",
    security(("service_key" = [])),
    responses((status = 200, description = "Service identity ของ agent เอง", body = AgentContextResponse)))]
pub(crate) async fn context(
    ServiceIdentityAuth(identity): ServiceIdentityAuth,
) -> Json<AgentContextResponse> {
    Json(AgentContextResponse {
        service_identity_id: identity.id,
        name: identity.name,
        organization_id: identity.organization_id,
    })
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct ProposeWorkflowRequest {
    resource_type: String,
    resource_id: Uuid,
    #[serde(default = "default_context")]
    context: Value,
    rule: Option<orva_workflow::Rule>,
    /// ต้องระบุถ้า `rule` trigger การขออนุมัติ — มอบให้ human กดอนุมัติ/ปฏิเสธผ่าน
    /// `/api/v1/approval-tasks/{id}/approve` ตามปกติ (ARCHITECTURE.md §12: "ขอ Approval ถ้าจำเป็น")
    approver_id: Option<Uuid>,
}

fn default_context() -> Value {
    serde_json::json!({})
}

/// Agent เสนอ "การกระทำ" หนึ่งอย่างเป็น workflow instance — ถ้า `rule` ไม่ trigger ระบบ
/// ข้ามไป Executing ให้ทันที (agent ถือว่าทำต่อได้เลย) ถ้า trigger ต้องรอ human อนุมัติก่อน
/// ผ่าน Workflow Engine เดียวกับที่ user ใช้ (approval hook ตาม MILESTONES.md M8)
#[utoipa::path(post, path = "/api/v1/agent/workflows", tag = "agent",
    security(("service_key" = [])),
    request_body = ProposeWorkflowRequest,
    responses((status = 201, description = "เสนอ action สำเร็จ — เช็ค status ว่าต้องรออนุมัติไหม", body = WorkflowResponse)))]
pub(crate) async fn propose_workflow(
    State(state): State<AppState>,
    ServiceIdentityAuth(identity): ServiceIdentityAuth,
    Json(body): Json<ProposeWorkflowRequest>,
) -> Result<(axum::http::StatusCode, Json<WorkflowResponse>), ApiError> {
    let instance = state
        .workflow
        .create(
            identity.organization_id,
            &body.resource_type,
            body.resource_id,
            body.context,
            body.rule,
            None,
        )
        .await?;
    state
        .workflow
        .start_review(identity.organization_id, instance.id)
        .await?;
    let instance = state
        .workflow
        .evaluate_and_advance(identity.organization_id, instance.id, body.approver_id)
        .await?;

    Ok((axum::http::StatusCode::CREATED, Json(instance.into())))
}

#[utoipa::path(get, path = "/api/v1/agent/workflows/{id}", tag = "agent",
    security(("service_key" = [])),
    params(("id" = Uuid, Path)),
    responses((status = 200, description = "สถานะปัจจุบันของ action ที่เคยเสนอไว้", body = WorkflowResponse)))]
pub(crate) async fn get_workflow(
    State(state): State<AppState>,
    ServiceIdentityAuth(identity): ServiceIdentityAuth,
    Path(id): Path<Uuid>,
) -> Result<Json<WorkflowResponse>, ApiError> {
    let instance = state.workflow.get(identity.organization_id, id).await?;
    Ok(Json(instance.into()))
}
