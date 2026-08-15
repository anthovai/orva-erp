//! HTTP adapter สำหรับ OSS module ที่รันแยก process (ADR 0014) — Horilla/InvenTree ฯลฯ
//!
//! ORVA เป็น **authenticated proxy**: client เรียก `/api/v1/ext/{name}/...` ด้วย session
//! ปกติ → Core auth แล้ว forward ไป `base_url` ของ module พร้อมแนบ identity assertion
//! (JWT RS256 อายุ 60 วิ ใน `X-Orva-Identity`) ให้ module verify ผ่าน JWKS เอง —
//! ไม่มี secret แชร์ระหว่าง Core กับ module

use axum::body::Body;
use axum::extract::{Path, Request, State};
use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum::response::Response;
use axum::routing::{any, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;
use validator::Validate;

use crate::{
    error::ApiError,
    extractor::{AuthUser, RequirePermission},
    permissions::ModuleManage,
    state::AppState,
    validation::ValidatedJson,
};

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/external-modules",
            post(register_module).get(list_modules),
        )
        .route(
            "/api/v1/external-modules/{name}/enable",
            post(enable_module),
        )
        .route(
            "/api/v1/external-modules/{name}/disable",
            post(disable_module),
        )
        .route("/api/v1/ext/{name}/{*path}", any(proxy))
}

#[derive(Deserialize, Validate, ToSchema)]
pub(crate) struct RegisterExternalModuleRequest {
    /// ชื่อใน path `/api/v1/ext/{name}/...` — a-z0-9, `-`, `_` (2-63 ตัว)
    #[validate(length(min = 2, max = 63))]
    name: String,
    /// origin ของ module เช่น `http://horilla.internal:8000` — เฉพาะ http/https
    #[validate(url)]
    base_url: String,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct ExternalModuleResponse {
    id: Uuid,
    name: String,
    base_url: String,
    enabled: bool,
}

impl From<orva_data::ExternalModule> for ExternalModuleResponse {
    fn from(m: orva_data::ExternalModule) -> Self {
        Self {
            id: m.id,
            name: m.name,
            base_url: m.base_url,
            enabled: m.enabled,
        }
    }
}

/// ลงทะเบียน external module (upsert ตามชื่อ — แก้ base_url ได้ด้วยการ register ซ้ำ)
#[utoipa::path(post, path = "/api/v1/external-modules", tag = "external-module",
    security(("bearer" = [])), request_body = RegisterExternalModuleRequest,
    responses((status = 201, description = "External module registered", body = ExternalModuleResponse),
               (status = 403, description = "Missing core.module.manage")))]
pub(crate) async fn register_module(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<ModuleManage>,
    ValidatedJson(body): ValidatedJson<RegisterExternalModuleRequest>,
) -> Result<(StatusCode, Json<ExternalModuleResponse>), ApiError> {
    // ตัด trailing slash กัน path ซ้อนตอน proxy
    let base_url = body.base_url.trim_end_matches('/').to_string();
    if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
        return Err(
            orva_error::Error::Validation("base_url must be http or https".to_string()).into(),
        );
    }
    let module = state
        .external_modules
        .register(user.organization_id, &body.name, &base_url, Some(user.id))
        .await?;
    Ok((StatusCode::CREATED, Json(module.into())))
}

#[utoipa::path(get, path = "/api/v1/external-modules", tag = "external-module",
    security(("bearer" = [])),
    responses((status = 200, description = "External modules ขององค์กร", body = [ExternalModuleResponse])))]
pub(crate) async fn list_modules(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<ModuleManage>,
) -> Result<Json<Vec<ExternalModuleResponse>>, ApiError> {
    let modules = state.external_modules.list(user.organization_id).await?;
    Ok(Json(
        modules
            .into_iter()
            .map(ExternalModuleResponse::from)
            .collect(),
    ))
}

#[utoipa::path(post, path = "/api/v1/external-modules/{name}/enable", tag = "external-module",
    security(("bearer" = [])), params(("name" = String, Path)),
    responses((status = 204, description = "Enabled")))]
pub(crate) async fn enable_module(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<ModuleManage>,
    Path(name): Path<String>,
) -> Result<StatusCode, ApiError> {
    state
        .external_modules
        .set_enabled(user.organization_id, &name, true)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(post, path = "/api/v1/external-modules/{name}/disable", tag = "external-module",
    security(("bearer" = [])), params(("name" = String, Path)),
    responses((status = 204, description = "Disabled")))]
pub(crate) async fn disable_module(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<ModuleManage>,
    Path(name): Path<String>,
) -> Result<StatusCode, ApiError> {
    state
        .external_modules
        .set_enabled(user.organization_id, &name, false)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// header ที่ห้าม copy ต่อ (hop-by-hop / ของที่ proxy เซ็ตเอง)
const SKIP_REQUEST_HEADERS: [&str; 6] = [
    "host",
    "authorization",
    "content-length",
    "connection",
    "x-orva-identity",
    // proxy เซ็ตเองหลัง auth — ห้าม copy ของ client (กัน spoof identity ไปหา module)
    "x-orva-user-email",
];
const SKIP_RESPONSE_HEADERS: [&str; 3] = ["transfer-encoding", "connection", "content-length"];

/// Proxy ทุก method ไป external module — auth ด้วย session ปกติ แล้วแนบ:
/// `X-Orva-Identity` (JWT RS256, aud `orva-module:<name>`, TTL 60 วิ — verify ผ่าน JWKS)
/// และ `X-Orva-Organization-Id` — การ authorize ละเอียดเป็นหน้าที่ของ module ปลายทาง
/// (Horilla/InvenTree มี role ของตัวเอง — map จาก claim ใน assertion)
#[utoipa::path(get, path = "/api/v1/ext/{name}/{path}", tag = "external-module",
    security(("bearer" = [])),
    params(("name" = String, Path), ("path" = String, Path)),
    responses((status = 200, description = "Response จาก external module ส่งกลับตรง ๆ (ทุก method ไม่ใช่แค่ GET)"),
               (status = 404, description = "Module ไม่ถูกลงทะเบียนหรือถูกปิดใช้งาน"),
               (status = 502, description = "Module ปลายทางไม่ตอบ")))]
pub(crate) async fn proxy(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path((name, path)): Path<(String, String)>,
    request: Request,
) -> Result<Response, ApiError> {
    let module = state
        .external_modules
        .find_by_name(user.organization_id, &name)
        .await?
        .filter(|m| m.enabled)
        .ok_or_else(|| orva_error::Error::NotFound(format!("external module '{name}'")))?;

    let assertion = state.auth.issue_identity_assertion(&user, &module.name)?;

    let mut url = format!("{}/{}", module.base_url, path);
    if let Some(query) = request.uri().query() {
        url.push('?');
        url.push_str(query);
    }

    let method = reqwest::Method::from_bytes(request.method().as_str().as_bytes())
        .map_err(|_| orva_error::Error::Validation("unsupported method".to_string()))?;

    let mut outbound = state.http_client.request(method, &url);
    for (key, value) in request.headers() {
        if SKIP_REQUEST_HEADERS.contains(&key.as_str()) {
            continue;
        }
        if let Ok(v) = value.to_str() {
            outbound = outbound.header(key.as_str(), v);
        }
    }
    outbound = outbound
        .header("x-orva-identity", &assertion)
        .header("x-orva-organization-id", user.organization_id.to_string())
        // สำหรับ module ที่รองรับ remote-user auth ในตัว (เช่น InvenTree) —
        // ปลอดภัยเฉพาะเมื่อ module รับ traffic จาก proxy นี้เท่านั้น (ดู docs/modules/)
        .header("x-orva-user-email", &user.email);

    let body_bytes = axum::body::to_bytes(request.into_body(), 10 * 1024 * 1024)
        .await
        .map_err(|e| orva_error::Error::Validation(format!("read request body failed: {e}")))?;
    if !body_bytes.is_empty() {
        outbound = outbound.body(body_bytes);
    }

    let upstream = outbound.send().await.map_err(|e| {
        tracing::warn!(module = %name, error = %e, "external module unreachable");
        orva_error::Error::Internal(format!("external module '{name}' unreachable: {e}"))
    })?;

    let status =
        StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let mut response = Response::builder().status(status);
    for (key, value) in upstream.headers() {
        if SKIP_RESPONSE_HEADERS.contains(&key.as_str()) {
            continue;
        }
        if let (Ok(k), Ok(v)) = (
            HeaderName::from_bytes(key.as_ref()),
            HeaderValue::from_bytes(value.as_ref()),
        ) {
            response = response.header(k, v);
        }
    }
    let body = upstream
        .bytes()
        .await
        .map_err(|e| orva_error::Error::Internal(format!("read upstream body failed: {e}")))?;

    response.body(Body::from(body)).map_err(|e| {
        orva_error::Error::Internal(format!("build proxy response failed: {e}")).into()
    })
}
