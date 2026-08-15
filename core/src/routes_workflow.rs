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
        .route(
            "/api/v1/workflow-definitions",
            post(create_definition).get(list_definitions),
        )
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
pub(crate) struct CreateDefinitionRequest {
    name: String,
    resource_type: String,
    rule: Option<orva_workflow::Rule>,
    default_approver_id: Option<Uuid>,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct WorkflowDefinitionResponse {
    id: Uuid,
    name: String,
    resource_type: String,
    rule: Option<Value>,
    default_approver_id: Option<Uuid>,
    enabled: bool,
}

impl From<orva_workflow::WorkflowDefinition> for WorkflowDefinitionResponse {
    fn from(d: orva_workflow::WorkflowDefinition) -> Self {
        Self {
            id: d.id,
            name: d.name,
            resource_type: d.resource_type,
            rule: d.rule,
            default_approver_id: d.default_approver_id,
            enabled: d.enabled,
        }
    }
}

/// ตั้ง workflow definition ใช้ซ้ำ (ADR 0009) — ตั้ง rule/ผู้อนุมัติ default ครั้งเดียว
/// แล้วสร้าง instance อ้าง `definition_id` ได้เรื่อย ๆ
#[utoipa::path(post, path = "/api/v1/workflow-definitions", tag = "workflow",
    security(("bearer" = [])),
    request_body = CreateDefinitionRequest,
    responses((status = 201, description = "Workflow definition created", body = WorkflowDefinitionResponse)))]
pub(crate) async fn create_definition(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<WorkflowManage>,
    Json(body): Json<CreateDefinitionRequest>,
) -> Result<(StatusCode, Json<WorkflowDefinitionResponse>), ApiError> {
    let definition = state
        .workflow
        .create_definition(
            user.organization_id,
            &body.name,
            &body.resource_type,
            body.rule,
            body.default_approver_id,
            Some(user.id),
        )
        .await?;
    Ok((StatusCode::CREATED, Json(definition.into())))
}

#[utoipa::path(get, path = "/api/v1/workflow-definitions", tag = "workflow",
    security(("bearer" = [])),
    responses((status = 200, description = "Workflow definitions of caller's organization", body = [WorkflowDefinitionResponse])))]
pub(crate) async fn list_definitions(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<WorkflowManage>,
) -> Result<Json<Vec<WorkflowDefinitionResponse>>, ApiError> {
    let definitions = state
        .workflow
        .list_definitions(user.organization_id)
        .await?;
    Ok(Json(
        definitions
            .into_iter()
            .map(WorkflowDefinitionResponse::from)
            .collect(),
    ))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct CreateWorkflowRequest {
    /// อ้าง definition ที่ตั้งไว้ (ADR 0009) — ใช้แทน `resource_type`+`rule`
    definition_id: Option<Uuid>,
    /// จำเป็นเมื่อไม่ใช้ `definition_id`
    resource_type: Option<String>,
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

/// สร้าง workflow instance — 2 ทาง: อ้าง `definition_id` (copy resource_type/rule จาก
/// definition) หรือส่ง `resource_type`+`rule` inline แบบเดิม (ระบุพร้อมกันไม่ได้ — 400)
#[utoipa::path(post, path = "/api/v1/workflows", tag = "workflow",
    security(("bearer" = [])),
    request_body = CreateWorkflowRequest,
    responses((status = 201, description = "Workflow instance created", body = WorkflowResponse),
               (status = 400, description = "definition_id and inline resource_type/rule are mutually exclusive")))]
pub(crate) async fn create_workflow(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<WorkflowManage>,
    Json(body): Json<CreateWorkflowRequest>,
) -> Result<(StatusCode, Json<WorkflowResponse>), ApiError> {
    let instance = match (body.definition_id, body.resource_type) {
        (Some(definition_id), None) => {
            if body.rule.is_some() {
                return Err(orva_error::Error::Validation(
                    "rule cannot be combined with definition_id — the definition's rule is used"
                        .to_string(),
                )
                .into());
            }
            state
                .workflow
                .create_from_definition(
                    user.organization_id,
                    definition_id,
                    body.resource_id,
                    body.context,
                    Some(user.id),
                )
                .await?
        }
        (None, Some(resource_type)) => {
            state
                .workflow
                .create(
                    user.organization_id,
                    &resource_type,
                    body.resource_id,
                    body.context,
                    body.rule,
                    Some(user.id),
                )
                .await?
        }
        _ => {
            return Err(orva_error::Error::Validation(
                "provide exactly one of definition_id or resource_type".to_string(),
            )
            .into())
        }
    };
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
