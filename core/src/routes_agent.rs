use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    error::ApiError, extractor::ServiceIdentityAuth, routes_worker::WorkerTaskResponse,
    routes_workflow::WorkflowResponse, state::AppState,
};

/// ORVA Agent API (M8) — จุดเชื่อมสำหรับ ORVA Worker (OpenWorker) ใน Phase ถัดไป
/// (ARCHITECTURE.md §12) auth ด้วย service identity (`X-Orva-Service-Key`) ไม่ใช่ user session
/// ทุก endpoint บังคับ scope ของ identity นั้น (ADR 0011) — key ถูกต้องอย่างเดียวไม่พอ
pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/agent/context", get(context))
        .route("/api/v1/agent/workflows", post(propose_workflow))
        .route("/api/v1/agent/workflows/{id}", get(get_workflow))
        .route("/api/v1/agent/events", post(publish_event))
        .route("/api/v1/agent/tasks", get(poll_tasks))
        .route("/api/v1/agent/tasks/{id}/claim", post(claim_task))
        .route("/api/v1/agent/tasks/{id}/result", post(report_task_result))
}

/// scope ไม่พอ → 403 พร้อมบอกชัดว่าขาด scope ไหน (คนตั้ง integration จะได้แก้ถูก)
fn require_scope(identity: &orva_data::ServiceIdentity, scope: &str) -> Result<(), ApiError> {
    if identity.has_scope(scope) {
        Ok(())
    } else {
        Err(orva_error::Error::Forbidden(format!("missing agent scope '{scope}'")).into())
    }
}

#[derive(Serialize, ToSchema)]
pub(crate) struct AgentContextResponse {
    service_identity_id: Uuid,
    name: String,
    organization_id: Uuid,
    /// สิ่งที่ identity นี้ได้รับอนุญาตให้ทำ (ADR 0011)
    scopes: Vec<String>,
}

/// agent เช็คตัวเอง — เทียบเท่า `/me` ของ user
#[utoipa::path(get, path = "/api/v1/agent/context", tag = "agent",
    security(("service_key" = [])),
    responses((status = 200, description = "Service identity ของ agent เอง", body = AgentContextResponse),
               (status = 403, description = "Missing scope agent:context:read")))]
pub(crate) async fn context(
    ServiceIdentityAuth(identity): ServiceIdentityAuth,
) -> Result<Json<AgentContextResponse>, ApiError> {
    require_scope(&identity, "agent:context:read")?;
    Ok(Json(AgentContextResponse {
        service_identity_id: identity.id,
        name: identity.name,
        organization_id: identity.organization_id,
        scopes: identity.scopes,
    }))
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
    // scope แบบเจาะจง resource_type ก็ผ่านได้ (agent:workflow:propose:<type>) — ADR 0011
    if !identity.may_propose(&body.resource_type) {
        return Err(orva_error::Error::Forbidden(format!(
            "missing agent scope 'agent:workflow:propose' (or ':{}')",
            body.resource_type
        ))
        .into());
    }
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
    require_scope(&identity, "agent:workflow:read")?;
    let instance = state.workflow.get(identity.organization_id, id).await?;
    Ok(Json(instance.into()))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct PublishEventRequest {
    /// เช่น `horilla.employee.created` — แนะนำ prefix ด้วยชื่อ module ของตัวเอง
    event_type: String,
    #[serde(default = "default_context")]
    payload: Value,
    resource_type: Option<String>,
    resource_id: Option<Uuid>,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct PublishEventResponse {
    event_id: Uuid,
    event_type: String,
}

/// External module/agent publish event เข้า ORVA Event Bus (ADR 0014) — เข้าทั้ง
/// audit log และ Intelligence Engine (rule ที่เฝ้า event_type นี้ประเมินทันที)
/// ต้องมี scope `agent:event:publish`
#[utoipa::path(post, path = "/api/v1/agent/events", tag = "agent",
    security(("service_key" = [])), request_body = PublishEventRequest,
    responses((status = 201, description = "Event published", body = PublishEventResponse),
               (status = 403, description = "Missing scope agent:event:publish")))]
pub(crate) async fn publish_event(
    State(state): State<AppState>,
    ServiceIdentityAuth(identity): ServiceIdentityAuth,
    Json(body): Json<PublishEventRequest>,
) -> Result<(axum::http::StatusCode, Json<PublishEventResponse>), ApiError> {
    require_scope(&identity, "agent:event:publish")?;
    if body.event_type.trim().is_empty() || body.event_type.len() > 200 {
        return Err(orva_error::Error::Validation(
            "event_type must be 1-200 characters".to_string(),
        )
        .into());
    }

    let event = state
        .event_bus
        .publish(
            identity.organization_id,
            &body.event_type,
            body.payload,
            orva_events::PublishOptions {
                resource: body.resource_type.zip(body.resource_id),
                ..Default::default()
            },
        )
        .await?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(PublishEventResponse {
            event_id: event.id,
            event_type: event.event_type,
        }),
    ))
}

/// สร้างงานเข้าคิว + publish event — จุดเดียวที่ทั้งฝั่งมนุษย์ (`routes_worker`)
/// และฝั่ง recommendation accept ใช้ร่วมกัน (ADR 0019)
pub(crate) async fn queue_worker_task(
    state: &AppState,
    organization_id: Uuid,
    instruction: &str,
    source: &str,
    source_id: Option<Uuid>,
    created_by: Option<Uuid>,
) -> Result<orva_data::WorkerTask, ApiError> {
    let task = state
        .worker_tasks
        .create(
            organization_id,
            orva_data::CreateWorkerTaskParams {
                instruction,
                source,
                source_id,
                created_by,
            },
        )
        .await?;

    state
        .event_bus
        .publish(
            organization_id,
            orva_events::catalog::WORKER_TASK_CREATED,
            serde_json::json!({ "task_id": task.id, "source": source }),
            orva_events::PublishOptions {
                actor_user_id: created_by,
                resource: Some(("worker_task".to_string(), task.id)),
                ..Default::default()
            },
        )
        .await?;

    Ok(task)
}

/// Worker poll คิวงานที่รออยู่ (FIFO) — ORVA ยิงเข้าหา worker ไม่ได้เพราะ worker
/// รันบนเครื่องผู้ใช้หลัง NAT จึงใช้ pull model (ADR 0019)
#[utoipa::path(get, path = "/api/v1/agent/tasks", tag = "agent",
    security(("service_key" = [])),
    responses((status = 200, description = "งานที่รอ worker (เก่าก่อน)", body = [WorkerTaskResponse]),
               (status = 403, description = "Missing scope agent:task:read")))]
pub(crate) async fn poll_tasks(
    State(state): State<AppState>,
    ServiceIdentityAuth(identity): ServiceIdentityAuth,
) -> Result<Json<Vec<WorkerTaskResponse>>, ApiError> {
    require_scope(&identity, "agent:task:read")?;
    let tasks = state
        .worker_tasks
        .list_pending(identity.organization_id, 20)
        .await?;
    Ok(Json(
        tasks.into_iter().map(WorkerTaskResponse::from).collect(),
    ))
}

/// จองงานก่อนลงมือ — atomic ที่ระดับ DB จึงปลอดภัยเมื่อ worker หลายตัว poll คิวเดียวกัน
/// (ตัวที่ช้ากว่าได้ 409 แล้วไป claim ชิ้นถัดไป)
#[utoipa::path(post, path = "/api/v1/agent/tasks/{id}/claim", tag = "agent",
    security(("service_key" = [])), params(("id" = Uuid, Path)),
    responses((status = 200, description = "Claimed — งานเป็นของ worker ตัวนี้แล้ว", body = WorkerTaskResponse),
               (status = 409, description = "Another worker claimed it first (or it is no longer pending)"),
               (status = 403, description = "Missing scope agent:task:write")))]
pub(crate) async fn claim_task(
    State(state): State<AppState>,
    ServiceIdentityAuth(identity): ServiceIdentityAuth,
    Path(id): Path<Uuid>,
) -> Result<Json<WorkerTaskResponse>, ApiError> {
    require_scope(&identity, "agent:task:write")?;
    let task = state
        .worker_tasks
        .claim(identity.organization_id, id, identity.id)
        .await?
        .ok_or_else(|| {
            orva_error::Error::Conflict(
                "worker task is no longer pending — another worker claimed it first".to_string(),
            )
        })?;

    state
        .event_bus
        .publish(
            identity.organization_id,
            orva_events::catalog::WORKER_TASK_CLAIMED,
            serde_json::json!({ "task_id": id, "service_identity_id": identity.id }),
            orva_events::PublishOptions {
                resource: Some(("worker_task".to_string(), id)),
                ..Default::default()
            },
        )
        .await?;

    Ok(Json(task.into()))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct TaskResultRequest {
    succeeded: bool,
    /// ผลงานที่ทำเสร็จ (เมื่อ succeeded)
    result: Option<String>,
    /// เหตุผลที่ทำไม่สำเร็จ (เมื่อ !succeeded)
    error: Option<String>,
}

/// Worker รายงานผลกลับ — ปิดวงจร Control Plane → Execution Plane → Control Plane
/// คนที่สั่งงานได้ notification ทันที (ADR 0013 push ผ่าน SSE ให้อยู่แล้ว)
#[utoipa::path(post, path = "/api/v1/agent/tasks/{id}/result", tag = "agent",
    security(("service_key" = [])), params(("id" = Uuid, Path)), request_body = TaskResultRequest,
    responses((status = 200, description = "ผลถูกบันทึก", body = WorkerTaskResponse),
               (status = 400, description = "Task is not running (never claimed, or already reported)"),
               (status = 403, description = "Missing scope agent:task:write")))]
pub(crate) async fn report_task_result(
    State(state): State<AppState>,
    ServiceIdentityAuth(identity): ServiceIdentityAuth,
    Path(id): Path<Uuid>,
    Json(body): Json<TaskResultRequest>,
) -> Result<Json<WorkerTaskResponse>, ApiError> {
    require_scope(&identity, "agent:task:write")?;
    let task = state
        .worker_tasks
        .complete(
            identity.organization_id,
            id,
            body.succeeded,
            body.result.as_deref(),
            body.error.as_deref(),
        )
        .await?
        .ok_or_else(|| {
            orva_error::Error::Validation(
                "worker task is not running — claim it before reporting a result".to_string(),
            )
        })?;

    // แจ้งคนที่สั่งงาน (best-effort — งานเสร็จแล้วจริง ไม่ควรพังเพราะแจ้งเตือนไม่ผ่าน)
    if let Some(user_id) = task.created_by {
        let title = if body.succeeded {
            "Worker task succeeded"
        } else {
            "Worker task failed"
        };
        let detail = task
            .result
            .as_deref()
            .or(task.error.as_deref())
            .unwrap_or("(no detail reported)");
        if let Err(e) = state
            .notifications
            .notify(
                identity.organization_id,
                user_id,
                title,
                &format!("{}: {detail}", task.instruction),
            )
            .await
        {
            tracing::warn!(task_id = %id, error = %e, "worker task completion notification failed");
        }
    }

    state
        .event_bus
        .publish(
            identity.organization_id,
            orva_events::catalog::WORKER_TASK_COMPLETED,
            serde_json::json!({ "task_id": id, "succeeded": body.succeeded }),
            orva_events::PublishOptions {
                resource: Some(("worker_task".to_string(), id)),
                ..Default::default()
            },
        )
        .await?;

    Ok(Json(task.into()))
}
