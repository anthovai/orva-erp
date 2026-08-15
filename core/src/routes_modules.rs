use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;
use utoipa::ToSchema;

use crate::{
    error::ApiError, extractor::RequirePermission, permissions::ModuleManage, state::AppState,
};

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/modules", get(list_modules))
        .route("/api/v1/modules/{name}/install", post(install_module))
        .route("/api/v1/modules/{name}/enable", post(enable_module))
        .route("/api/v1/modules/{name}/disable", post(disable_module))
}

#[derive(Serialize, ToSchema)]
pub(crate) struct ModuleInfo {
    name: &'static str,
    version: &'static str,
    dependencies: Vec<&'static str>,
    permissions: Vec<&'static str>,
    events_published: Vec<&'static str>,
    events_subscribed: Vec<&'static str>,
    /// สถานะติดตั้งขององค์กรผู้เรียก — `None` = ยังไม่เคย install
    installed: Option<InstallStatus>,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct InstallStatus {
    version: String,
    enabled: bool,
}

/// รายชื่อ module ที่ compile เข้า binary นี้ทั้งหมด (M7 Module Contract: Manifest/Version/
/// Dependencies/Permissions/Events) พร้อมสถานะ install ขององค์กรผู้เรียก
#[utoipa::path(get, path = "/api/v1/modules", tag = "modules",
    security(("bearer" = [])),
    responses((status = 200, description = "Module ทั้งหมดที่มีในระบบ + สถานะ install", body = [ModuleInfo])))]
pub(crate) async fn list_modules(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<ModuleManage>,
) -> Result<Json<Vec<ModuleInfo>>, ApiError> {
    let mut result = Vec::new();
    for manifest in state.modules.manifests() {
        let installed = state
            .module_context
            .installations
            .find(user.organization_id, manifest.name)
            .await?
            .map(|m| InstallStatus {
                version: m.version,
                enabled: m.enabled,
            });
        result.push(ModuleInfo {
            name: manifest.name,
            version: manifest.version,
            dependencies: manifest.dependencies.to_vec(),
            permissions: manifest.permissions.iter().map(|(k, _)| *k).collect(),
            events_published: manifest.events_published.to_vec(),
            events_subscribed: manifest.events_subscribed.to_vec(),
            installed,
        });
    }
    Ok(Json(result))
}

/// ติดตั้ง module ให้องค์กรของผู้เรียก — module ต้องเป็นตัวที่ compile เข้า binary นี้แล้ว
/// เท่านั้น (ดู `GET /api/v1/modules` สำหรับรายชื่อที่มี)
#[utoipa::path(post, path = "/api/v1/modules/{name}/install", tag = "modules",
    security(("bearer" = [])),
    params(("name" = String, Path)),
    responses((status = 204, description = "Module installed for caller's organization"),
               (status = 404, description = "No such module compiled into this binary")))]
pub(crate) async fn install_module(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<ModuleManage>,
    Path(name): Path<String>,
) -> Result<StatusCode, ApiError> {
    let manifest = state
        .modules
        .manifests()
        .into_iter()
        .find(|m| m.name == name)
        .ok_or_else(|| orva_error::Error::NotFound(format!("module '{name}'")))?;

    state
        .module_context
        .installations
        .install(
            user.organization_id,
            manifest.name,
            manifest.version,
            user.id,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn set_enabled(
    state: AppState,
    organization_id: uuid::Uuid,
    name: &str,
    enabled: bool,
) -> Result<StatusCode, ApiError> {
    state
        .module_context
        .installations
        .find(organization_id, name)
        .await?
        .ok_or_else(|| orva_error::Error::NotFound(format!("module '{name}' is not installed")))?;
    state
        .module_context
        .installations
        .set_enabled(organization_id, name, enabled)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(post, path = "/api/v1/modules/{name}/enable", tag = "modules",
    security(("bearer" = [])),
    params(("name" = String, Path)),
    responses((status = 204, description = "Module enabled"), (status = 404, description = "Not installed")))]
pub(crate) async fn enable_module(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<ModuleManage>,
    Path(name): Path<String>,
) -> Result<StatusCode, ApiError> {
    set_enabled(state, user.organization_id, &name, true).await
}

#[utoipa::path(post, path = "/api/v1/modules/{name}/disable", tag = "modules",
    security(("bearer" = [])),
    params(("name" = String, Path)),
    responses((status = 204, description = "Module disabled"), (status = 404, description = "Not installed")))]
pub(crate) async fn disable_module(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<ModuleManage>,
    Path(name): Path<String>,
) -> Result<StatusCode, ApiError> {
    set_enabled(state, user.organization_id, &name, false).await
}
