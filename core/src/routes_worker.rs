//! ORVA Worker task queue — ฝั่งมนุษย์ (ADR 0019)
//!
//! ฝั่ง worker (service identity) อยู่ใน [`crate::routes_agent`] — สองฝั่งคุยกันผ่าน
//! ตารางคิวเดียวกัน โดย worker เป็นฝ่าย poll เข้ามา (ORVA ยิงออกไปหา worker ไม่ได้
//! เพราะ worker รันบนเครื่องผู้ใช้)

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;
use validator::Validate;

use crate::{
    error::ApiError,
    extractor::RequirePermission,
    permissions::{WorkerManage, WorkerRead},
    state::AppState,
    validation::ValidatedJson,
};

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/worker/tasks", post(create_task).get(list_tasks))
        .route("/api/v1/worker/tasks/{id}", get(get_task))
        .route("/api/v1/worker/tasks/{id}/cancel", post(cancel_task))
}

#[derive(Deserialize, Validate, ToSchema)]
pub(crate) struct CreateTaskRequest {
    /// สิ่งที่อยากให้ worker ทำ (ภาษาธรรมชาติ — worker วางแผนขั้นตอนเอง)
    #[validate(length(min = 1, max = 10_000))]
    instruction: String,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct WorkerTaskResponse {
    pub(crate) id: Uuid,
    pub(crate) instruction: String,
    /// `manual` | `recommendation` | `workflow`
    pub(crate) source: String,
    pub(crate) source_id: Option<Uuid>,
    /// `pending` | `running` | `succeeded` | `failed` | `cancelled`
    pub(crate) status: String,
    pub(crate) claimed_by: Option<Uuid>,
    pub(crate) result: Option<String>,
    pub(crate) error: Option<String>,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) completed_at: Option<DateTime<Utc>>,
}

impl From<orva_data::WorkerTask> for WorkerTaskResponse {
    fn from(t: orva_data::WorkerTask) -> Self {
        Self {
            id: t.id,
            instruction: t.instruction,
            source: t.source,
            source_id: t.source_id,
            status: t.status,
            claimed_by: t.claimed_by,
            result: t.result,
            error: t.error,
            created_at: t.created_at,
            completed_at: t.completed_at,
        }
    }
}

/// มอบงานให้ ORVA Worker — งานเข้าคิวสถานะ `pending` รอ worker มา claim
#[utoipa::path(post, path = "/api/v1/worker/tasks", tag = "worker",
    security(("bearer" = [])), request_body = CreateTaskRequest,
    responses((status = 201, description = "Task queued for the worker", body = WorkerTaskResponse)))]
pub(crate) async fn create_task(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<WorkerManage>,
    ValidatedJson(body): ValidatedJson<CreateTaskRequest>,
) -> Result<(StatusCode, Json<WorkerTaskResponse>), ApiError> {
    let task = crate::routes_agent::queue_worker_task(
        &state,
        user.organization_id,
        &body.instruction,
        "manual",
        None,
        Some(user.id),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(task.into())))
}

#[derive(Deserialize, IntoParams)]
pub(crate) struct TaskFilter {
    /// pending | running | succeeded | failed | cancelled — ไม่ระบุ = ทุกสถานะ
    status: Option<String>,
}

#[utoipa::path(get, path = "/api/v1/worker/tasks", tag = "worker",
    security(("bearer" = [])), params(TaskFilter),
    responses((status = 200, description = "งานที่มอบให้ worker (ล่าสุดก่อน)", body = [WorkerTaskResponse])))]
pub(crate) async fn list_tasks(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<WorkerRead>,
    Query(filter): Query<TaskFilter>,
) -> Result<Json<Vec<WorkerTaskResponse>>, ApiError> {
    let tasks = state
        .worker_tasks
        .list(user.organization_id, filter.status.as_deref(), 50)
        .await?;
    Ok(Json(
        tasks.into_iter().map(WorkerTaskResponse::from).collect(),
    ))
}

#[utoipa::path(get, path = "/api/v1/worker/tasks/{id}", tag = "worker",
    security(("bearer" = [])), params(("id" = Uuid, Path)),
    responses((status = 200, description = "งานหนึ่งชิ้น + ผลลัพธ์", body = WorkerTaskResponse),
               (status = 404, description = "Not found in caller's organization")))]
pub(crate) async fn get_task(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<WorkerRead>,
    Path(id): Path<Uuid>,
) -> Result<Json<WorkerTaskResponse>, ApiError> {
    let task = state
        .worker_tasks
        .find_by_id(user.organization_id, id)
        .await?
        .ok_or_else(|| orva_error::Error::NotFound(format!("worker task '{id}'")))?;
    Ok(Json(task.into()))
}

/// ยกเลิกงานที่ยังไม่ถูก claim — งานที่ worker ลงมือแล้วยกเลิกไม่ได้ (400)
#[utoipa::path(post, path = "/api/v1/worker/tasks/{id}/cancel", tag = "worker",
    security(("bearer" = [])), params(("id" = Uuid, Path)),
    responses((status = 200, description = "Cancelled", body = WorkerTaskResponse),
               (status = 400, description = "Already claimed by a worker or already finished")))]
pub(crate) async fn cancel_task(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<WorkerManage>,
    Path(id): Path<Uuid>,
) -> Result<Json<WorkerTaskResponse>, ApiError> {
    let task = state
        .worker_tasks
        .cancel(user.organization_id, id)
        .await?
        .ok_or_else(|| {
            orva_error::Error::Validation(
                "worker task not found or no longer pending — a claimed task cannot be cancelled"
                    .to_string(),
            )
        })?;

    state
        .event_bus
        .publish(
            user.organization_id,
            orva_events::catalog::WORKER_TASK_CANCELLED,
            serde_json::json!({ "task_id": id }),
            orva_events::PublishOptions {
                actor_user_id: Some(user.id),
                resource: Some(("worker_task".to_string(), id)),
                ..Default::default()
            },
        )
        .await?;

    Ok(Json(task.into()))
}
