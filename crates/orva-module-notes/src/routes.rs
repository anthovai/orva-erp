use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use orva_data::DocumentRepository;
use orva_events::PublishOptions;
use orva_module_sdk::{ModuleApiError, ModuleContext, RequireModulePermission};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::{
    catalog,
    permissions::{DocumentManage, DocumentRead},
};

pub fn router() -> Router<ModuleContext> {
    Router::new()
        .route("/api/v1/modules/notes/documents", post(create).get(list))
        .route(
            "/api/v1/modules/notes/documents/{id}",
            get(get_one).delete(remove),
        )
}

#[derive(Deserialize)]
struct CreateDocumentRequest {
    title: String,
    #[serde(default)]
    content: String,
}

#[derive(Serialize)]
struct DocumentResponse {
    id: Uuid,
    title: String,
    content: String,
}

impl From<orva_data::Document> for DocumentResponse {
    fn from(d: orva_data::Document) -> Self {
        Self {
            id: d.id,
            title: d.title,
            content: d.content,
        }
    }
}

async fn create(
    State(ctx): State<ModuleContext>,
    RequireModulePermission(user, ..): RequireModulePermission<DocumentManage>,
    Json(body): Json<CreateDocumentRequest>,
) -> Result<(StatusCode, Json<DocumentResponse>), ModuleApiError> {
    let documents = DocumentRepository::new(ctx.pool.clone());
    let document = documents
        .create(
            user.organization_id,
            &body.title,
            &body.content,
            Some(user.id),
        )
        .await?;

    ctx.events
        .publish(
            user.organization_id,
            catalog::DOCUMENT_CREATED,
            json!({ "document_id": document.id, "title": document.title }),
            PublishOptions {
                actor_user_id: Some(user.id),
                resource: Some(("document".to_string(), document.id)),
                ..Default::default()
            },
        )
        .await?;

    Ok((StatusCode::CREATED, Json(document.into())))
}

async fn list(
    State(ctx): State<ModuleContext>,
    RequireModulePermission(user, ..): RequireModulePermission<DocumentRead>,
) -> Result<Json<Vec<DocumentResponse>>, ModuleApiError> {
    let documents = DocumentRepository::new(ctx.pool.clone());
    let list = documents.list(user.organization_id).await?;
    Ok(Json(list.into_iter().map(DocumentResponse::from).collect()))
}

async fn get_one(
    State(ctx): State<ModuleContext>,
    RequireModulePermission(user, ..): RequireModulePermission<DocumentRead>,
    Path(id): Path<Uuid>,
) -> Result<Json<DocumentResponse>, ModuleApiError> {
    let documents = DocumentRepository::new(ctx.pool.clone());
    let document = documents
        .find_by_id(user.organization_id, id)
        .await?
        .ok_or_else(|| orva_error::Error::NotFound(format!("document '{id}'")))?;
    Ok(Json(document.into()))
}

async fn remove(
    State(ctx): State<ModuleContext>,
    RequireModulePermission(user, ..): RequireModulePermission<DocumentManage>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ModuleApiError> {
    let documents = DocumentRepository::new(ctx.pool.clone());
    documents.soft_delete(user.organization_id, id).await?;

    ctx.events
        .publish(
            user.organization_id,
            catalog::DOCUMENT_DELETED,
            json!({ "document_id": id }),
            PublishOptions {
                actor_user_id: Some(user.id),
                resource: Some(("document".to_string(), id)),
                ..Default::default()
            },
        )
        .await?;

    Ok(StatusCode::NO_CONTENT)
}
