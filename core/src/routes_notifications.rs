use std::convert::Infallible;
use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use futures_util::stream::{Stream, StreamExt};
use serde::{Deserialize, Serialize};
use tokio_stream::wrappers::BroadcastStream;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{error::ApiError, extractor::AuthUser, state::AppState};

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/notifications", get(list_notifications))
        .route("/api/v1/notifications/stream", get(stream_notifications))
        .route("/api/v1/notifications/{id}/read", post(mark_read))
        .route("/api/v1/notification-preferences", put(set_preference))
}

/// Real-time push (ADR 0013) — SSE stream ของ in-app notification ที่เกิด**หลัง** subscribe
/// (ของเก่าอ่านจาก `GET /api/v1/notifications` — DB คือ source of truth, stream เป็น
/// best-effort ต่อ connection) event ชื่อ `notification`, payload = JSON แบบเดียวกับ list
#[utoipa::path(get, path = "/api/v1/notifications/stream", tag = "notification",
    security(("bearer" = [])),
    responses((status = 200, description = "text/event-stream ของ notification ใหม่ของผู้เรียกเอง")))]
pub(crate) async fn stream_notifications(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let organization_id = user.organization_id;
    let user_id = user.id;
    let stream = BroadcastStream::new(state.notification_hub.subscribe()).filter_map(
        move |item| async move {
            match item {
                // hub เป็น broadcast กลาง — กรองเฉพาะของ user คนนี้ (tenant + user ตรง)
                Ok(n) if n.organization_id == organization_id && n.user_id == user_id => {
                    let event = Event::default()
                        .event("notification")
                        .json_data(NotificationResponse::from(n))
                        .ok()?;
                    Some(Ok(event))
                }
                // ของคนอื่น หรือ subscriber ช้าจน lag — ข้าม (client sync ผ่าน list ได้เสมอ)
                _ => None,
            }
        },
    );
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
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
