use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    error::ApiError,
    extractor::{AuthUser, RequirePermission},
    permissions::WorkflowManage,
    state::AppState,
};

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/workflows", post(create_workflow))
        .route("/api/v1/workflows/{id}", get(get_workflow))
        .route("/api/v1/workflows/{id}/start-review", post(start_review))
        .route("/api/v1/workflows/{id}/advance", post(advance))
        .route("/api/v1/workflows/{id}/complete", post(complete))
        .route("/api/v1/approval-tasks/mine", get(my_pending_tasks))
        .route("/api/v1/approval-tasks/{id}/approve", post(approve_task))
        .route("/api/v1/approval-tasks/{id}/reject", post(reject_task))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct CreateWorkflowRequest {
    resource_type: String,
    resource_id: Uuid,
    #[serde(default = "default_context")]
    context: Value,
    rule: Option<orva_workflow::Rule>,
}

fn default_context() -> Value {
    serde_json::json!({})
}

#[derive(Serialize, ToSchema)]
pub(crate) struct WorkflowResponse {
    id: Uuid,
    resource_type: String,
    resource_id: Uuid,
    status: String,
    context: Value,
}

impl From<orva_workflow::WorkflowInstance> for WorkflowResponse {
    fn from(w: orva_workflow::WorkflowInstance) -> Self {
        Self {
            id: w.id,
            resource_type: w.resource_type,
            resource_id: w.resource_id,
            status: w.status,
            context: w.context,
        }
    }
}

/// สร้าง workflow instance ผูกกับ resource ใด ๆ (module ในอนาคตส่ง resource_type ของตัวเอง
/// มาได้ เช่น "invoice") — `rule` เป็นเงื่อนไข approval ตาม ARCHITECTURE.md §7 ถ้าไม่ระบุ = ไม่มีขั้นอนุมัติ
#[utoipa::path(post, path = "/api/v1/workflows", tag = "workflow",
    security(("bearer" = [])),
    request_body = CreateWorkflowRequest,
    responses((status = 201, description = "Workflow instance created", body = WorkflowResponse)))]
pub(crate) async fn create_workflow(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<WorkflowManage>,
    Json(body): Json<CreateWorkflowRequest>,
) -> Result<(StatusCode, Json<WorkflowResponse>), ApiError> {
    let instance = state
        .workflow
        .create(
            user.organization_id,
            &body.resource_type,
            body.resource_id,
            body.context,
            body.rule,
            Some(user.id),
        )
        .await?;
    Ok((StatusCode::CREATED, Json(instance.into())))
}

#[utoipa::path(get, path = "/api/v1/workflows/{id}", tag = "workflow",
    security(("bearer" = [])),
    params(("id" = Uuid, Path)),
    responses((status = 200, description = "Workflow instance", body = WorkflowResponse),
               (status = 404, description = "Not found in caller's organization")))]
pub(crate) async fn get_workflow(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<WorkflowManage>,
    Path(id): Path<Uuid>,
) -> Result<Json<WorkflowResponse>, ApiError> {
    let instance = state.workflow.get(user.organization_id, id).await?;
    Ok(Json(instance.into()))
}

#[utoipa::path(post, path = "/api/v1/workflows/{id}/start-review", tag = "workflow",
    security(("bearer" = [])),
    params(("id" = Uuid, Path)),
    responses((status = 200, description = "Moved to Review", body = WorkflowResponse),
               (status = 400, description = "Invalid transition from current status")))]
pub(crate) async fn start_review(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<WorkflowManage>,
    Path(id): Path<Uuid>,
) -> Result<Json<WorkflowResponse>, ApiError> {
    let instance = state
        .workflow
        .start_review(user.organization_id, id)
        .await?;
    Ok(Json(instance.into()))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct AdvanceWorkflowRequest {
    /// ต้องระบุถ้า rule trigger การขออนุมัติ — ไม่งั้นได้ 400
    approver_id: Option<Uuid>,
}

/// ประเมิน rule กับ context — trigger แล้วเข้า PendingApproval (สร้าง approval task ให้
/// `approver_id`) ไม่ trigger ก็ข้ามไป Executing ตรง ๆ
#[utoipa::path(post, path = "/api/v1/workflows/{id}/advance", tag = "workflow",
    security(("bearer" = [])),
    params(("id" = Uuid, Path)),
    request_body = AdvanceWorkflowRequest,
    responses((status = 200, description = "Advanced to PendingApproval or Executing", body = WorkflowResponse),
               (status = 400, description = "Rule triggered but approver_id missing, or invalid transition")))]
pub(crate) async fn advance(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<WorkflowManage>,
    Path(id): Path<Uuid>,
    Json(body): Json<AdvanceWorkflowRequest>,
) -> Result<Json<WorkflowResponse>, ApiError> {
    let instance = state
        .workflow
        .evaluate_and_advance(user.organization_id, id, body.approver_id)
        .await?;
    Ok(Json(instance.into()))
}

#[utoipa::path(post, path = "/api/v1/workflows/{id}/complete", tag = "workflow",
    security(("bearer" = [])),
    params(("id" = Uuid, Path)),
    responses((status = 200, description = "Moved to Completed", body = WorkflowResponse),
               (status = 400, description = "Invalid transition — must be Executing first")))]
pub(crate) async fn complete(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<WorkflowManage>,
    Path(id): Path<Uuid>,
) -> Result<Json<WorkflowResponse>, ApiError> {
    let instance = state.workflow.complete(user.organization_id, id).await?;
    Ok(Json(instance.into()))
}

#[derive(Serialize, ToSchema)]
pub(crate) struct ApprovalTaskResponse {
    id: Uuid,
    workflow_instance_id: Uuid,
    status: String,
}

impl From<orva_workflow::ApprovalTask> for ApprovalTaskResponse {
    fn from(t: orva_workflow::ApprovalTask) -> Self {
        Self {
            id: t.id,
            workflow_instance_id: t.workflow_instance_id,
            status: t.status,
        }
    }
}

/// งาน approve ที่รอ**ตัวเอง** อยู่ — ไม่ต้องมี permission พิเศษ (เป็นข้อมูลของตัวเอง เหมือน `/me`)
#[utoipa::path(get, path = "/api/v1/approval-tasks/mine", tag = "workflow",
    security(("bearer" = [])),
    responses((status = 200, description = "Pending approval tasks assigned to caller", body = [ApprovalTaskResponse])))]
pub(crate) async fn my_pending_tasks(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Json<Vec<ApprovalTaskResponse>>, ApiError> {
    let tasks = state
        .workflow
        .list_my_pending_tasks(user.organization_id, user.id)
        .await?;
    Ok(Json(
        tasks.into_iter().map(ApprovalTaskResponse::from).collect(),
    ))
}

/// อนุมัติได้เฉพาะคนที่ถูก assign เท่านั้น (เช็คใน `WorkflowService::approve` ไม่ใช่ permission
/// กว้าง ๆ) — คนอื่นเรียกได้ 403
#[utoipa::path(post, path = "/api/v1/approval-tasks/{id}/approve", tag = "workflow",
    security(("bearer" = [])),
    params(("id" = Uuid, Path)),
    responses((status = 200, description = "Approved — workflow moved to Executing", body = WorkflowResponse),
               (status = 403, description = "Not the assigned approver")))]
pub(crate) async fn approve_task(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<WorkflowResponse>, ApiError> {
    let instance = state
        .workflow
        .approve(user.organization_id, id, user.id)
        .await?;
    Ok(Json(instance.into()))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct RejectTaskRequest {
    reason: Option<String>,
}

#[utoipa::path(post, path = "/api/v1/approval-tasks/{id}/reject", tag = "workflow",
    security(("bearer" = [])),
    params(("id" = Uuid, Path)),
    request_body = RejectTaskRequest,
    responses((status = 200, description = "Rejected — workflow moved to terminal Rejected state", body = WorkflowResponse),
               (status = 403, description = "Not the assigned approver")))]
pub(crate) async fn reject_task(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<RejectTaskRequest>,
) -> Result<Json<WorkflowResponse>, ApiError> {
    let instance = state
        .workflow
        .reject(user.organization_id, id, user.id, body.reason.as_deref())
        .await?;
    Ok(Json(instance.into()))
}
