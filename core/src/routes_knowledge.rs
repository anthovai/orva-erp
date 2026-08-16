//! ORVA Knowledge API (ADR 0017) — linked notes + knowledge graph ต่อ tenant

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;
use validator::Validate;

use crate::{
    error::ApiError,
    extractor::RequirePermission,
    permissions::{KnowledgeManage, KnowledgeRead},
    state::AppState,
    validation::ValidatedJson,
};

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/knowledge/notes", post(create_note).get(list_notes))
        .route("/api/v1/knowledge/notes/{id}", get(get_note))
        .route("/api/v1/knowledge/notes/{id}", put(update_note))
        .route("/api/v1/knowledge/notes/{id}", delete(delete_note))
        .route("/api/v1/knowledge/graph", get(graph))
}

#[derive(Deserialize, Validate, ToSchema)]
pub(crate) struct CreateNoteRequest {
    #[validate(length(min = 1, max = 300))]
    title: String,
    /// เนื้อหาโน้ต — อ้างโน้ตอื่นด้วย `[[ชื่อโน้ต]]`, อ้าง canonical entity ด้วย
    /// `[[employee:email]]` / `[[product:sku]]`
    #[serde(default)]
    content: String,
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct UpdateNoteRequest {
    content: String,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct NoteResponse {
    id: Uuid,
    title: String,
    content: String,
    updated_at: DateTime<Utc>,
}

impl From<orva_knowledge::KnowledgeNote> for NoteResponse {
    fn from(n: orva_knowledge::KnowledgeNote) -> Self {
        Self {
            id: n.id,
            title: n.title,
            content: n.content,
            updated_at: n.updated_at,
        }
    }
}

#[derive(Serialize, ToSchema)]
pub(crate) struct LinkResponse {
    target_kind: String,
    target_ref: String,
    to_note_id: Option<Uuid>,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct NoteDetailResponse {
    #[serde(flatten)]
    note: NoteResponse,
    links: Vec<LinkResponse>,
    backlinks: Vec<NoteResponse>,
}

impl From<orva_knowledge::NoteWithLinks> for NoteDetailResponse {
    fn from(n: orva_knowledge::NoteWithLinks) -> Self {
        Self {
            note: n.note.into(),
            links: n
                .links
                .into_iter()
                .map(|l| LinkResponse {
                    target_kind: l.target_kind,
                    target_ref: l.target_ref,
                    to_note_id: l.to_note_id,
                })
                .collect(),
            backlinks: n.backlinks.into_iter().map(NoteResponse::from).collect(),
        }
    }
}

/// สร้างโน้ต — ลิงก์ในเนื้อหาถูกสกัดเก็บทันที และลิงก์ค้างจากโน้ตอื่นที่เคยชี้ชื่อนี้
/// ถูก resolve อัตโนมัติ
#[utoipa::path(post, path = "/api/v1/knowledge/notes", tag = "knowledge",
    security(("bearer" = [])), request_body = CreateNoteRequest,
    responses((status = 201, description = "Note created (links extracted)", body = NoteDetailResponse),
               (status = 400, description = "Duplicate title in organization")))]
pub(crate) async fn create_note(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<KnowledgeManage>,
    ValidatedJson(body): ValidatedJson<CreateNoteRequest>,
) -> Result<(StatusCode, Json<NoteDetailResponse>), ApiError> {
    let note = state
        .knowledge
        .create_note(
            user.organization_id,
            &body.title,
            &body.content,
            Some(user.id),
        )
        .await?;
    Ok((StatusCode::CREATED, Json(note.into())))
}

#[utoipa::path(get, path = "/api/v1/knowledge/notes", tag = "knowledge",
    security(("bearer" = [])),
    responses((status = 200, description = "Notes ทั้งหมดขององค์กร (ล่าสุดก่อน)", body = [NoteResponse])))]
pub(crate) async fn list_notes(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<KnowledgeRead>,
) -> Result<Json<Vec<NoteResponse>>, ApiError> {
    let notes = state.knowledge.list_notes(user.organization_id).await?;
    Ok(Json(notes.into_iter().map(NoteResponse::from).collect()))
}

#[utoipa::path(get, path = "/api/v1/knowledge/notes/{id}", tag = "knowledge",
    security(("bearer" = [])), params(("id" = Uuid, Path)),
    responses((status = 200, description = "Note + ลิงก์ขาออก + backlinks", body = NoteDetailResponse)))]
pub(crate) async fn get_note(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<KnowledgeRead>,
    Path(id): Path<Uuid>,
) -> Result<Json<NoteDetailResponse>, ApiError> {
    let note = state.knowledge.get_note(user.organization_id, id).await?;
    Ok(Json(note.into()))
}

#[utoipa::path(put, path = "/api/v1/knowledge/notes/{id}", tag = "knowledge",
    security(("bearer" = [])), params(("id" = Uuid, Path)), request_body = UpdateNoteRequest,
    responses((status = 200, description = "Note updated (links re-extracted)", body = NoteDetailResponse)))]
pub(crate) async fn update_note(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<KnowledgeManage>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateNoteRequest>,
) -> Result<Json<NoteDetailResponse>, ApiError> {
    let note = state
        .knowledge
        .update_note(user.organization_id, id, &body.content, Some(user.id))
        .await?;
    Ok(Json(note.into()))
}

#[utoipa::path(delete, path = "/api/v1/knowledge/notes/{id}", tag = "knowledge",
    security(("bearer" = [])), params(("id" = Uuid, Path)),
    responses((status = 204, description = "Note deleted (incoming links become pending again)")))]
pub(crate) async fn delete_note(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<KnowledgeManage>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    state
        .knowledge
        .delete_note(user.organization_id, id, Some(user.id))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize, ToSchema)]
pub(crate) struct GraphResponse {
    nodes: Vec<GraphNodeResponse>,
    edges: Vec<GraphEdgeResponse>,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct GraphNodeResponse {
    id: String,
    kind: String,
    label: String,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct GraphEdgeResponse {
    from: String,
    to: String,
    kind: String,
}

/// Knowledge graph ทั้งองค์กร — node ชนิด `note`/`employee`/`product`/`missing`
/// (missing = โน้ตที่ถูกอ้างแต่ยังไม่ถูกเขียน)
#[utoipa::path(get, path = "/api/v1/knowledge/graph", tag = "knowledge",
    security(("bearer" = [])),
    responses((status = 200, description = "Nodes + edges ของ knowledge graph", body = GraphResponse)))]
pub(crate) async fn graph(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<KnowledgeRead>,
) -> Result<Json<GraphResponse>, ApiError> {
    let graph = state.knowledge.graph(user.organization_id).await?;
    Ok(Json(GraphResponse {
        nodes: graph
            .nodes
            .into_iter()
            .map(|n| GraphNodeResponse {
                id: n.id,
                kind: n.kind,
                label: n.label,
            })
            .collect(),
        edges: graph
            .edges
            .into_iter()
            .map(|e| GraphEdgeResponse {
                from: e.from,
                to: e.to,
                kind: e.kind,
            })
            .collect(),
    }))
}
