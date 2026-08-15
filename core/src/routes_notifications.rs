use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{error::ApiError, extractor::AuthUser, state::AppState};

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/notifications", get(list_notifications))
        .route("/api/v1/notifications/{id}/read", post(mark_read))
        .route("/api/v1/notification-preferences", put(set_preference))
}

#[derive(Deserialize, IntoParams)]
pub(crate) struct ListNotificationsQuery {
    #[serde(default)]
    unread_only: bool,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct NotificationResponse {
    id: Uuid,
    channel: String,
    title: String,
    body: String,
    read_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

impl From<orva_notifications::Notification> for NotificationResponse {
    fn from(n: orva_notifications::Notification) -> Self {
        Self {
            id: n.id,
            channel: n.channel,
            title: n.title,
            body: n.body,
            read_at: n.read_at,
            created_at: n.created_at,
        }
    }
}

/// เห็นเฉพาะ notification ของตัวเอง — ไม่ต้องมี permission พิเศษ (ข้อมูลของตัวเอง)
#[utoipa::path(get, path = "/api/v1/notifications", tag = "notifications",
    security(("bearer" = [])),
    params(ListNotificationsQuery),
    responses((status = 200, description = "Notification ของตัวเอง (ทุก channel)", body = [NotificationResponse])))]
pub(crate) async fn list_notifications(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Query(query): Query<ListNotificationsQuery>,
) -> Result<Json<Vec<NotificationResponse>>, ApiError> {
    let notifications = state
        .notifications
        .list_for_user(user.organization_id, user.id, query.unread_only)
        .await?;
    Ok(Json(
        notifications
            .into_iter()
            .map(NotificationResponse::from)
            .collect(),
    ))
}

#[utoipa::path(post, path = "/api/v1/notifications/{id}/read", tag = "notifications",
    security(("bearer" = [])),
    params(("id" = Uuid, Path)),
    responses((status = 204, description = "Marked as read")))]
pub(crate) async fn mark_read(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    state
        .notifications
        .mark_read(user.organization_id, id, user.id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct SetNotificationPreferenceRequest {
    channel: String,
    enabled: bool,
}

#[utoipa::path(put, path = "/api/v1/notification-preferences", tag = "notifications",
    security(("bearer" = [])),
    request_body = SetNotificationPreferenceRequest,
    responses((status = 204, description = "Preference updated")))]
pub(crate) async fn set_preference(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Json(body): Json<SetNotificationPreferenceRequest>,
) -> Result<StatusCode, ApiError> {
    state
        .notifications
        .set_preference(user.organization_id, user.id, &body.channel, body.enabled)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
