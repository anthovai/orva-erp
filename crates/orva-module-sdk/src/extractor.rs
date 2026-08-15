use std::marker::PhantomData;

use axum::extract::FromRequestParts;
use axum::http::{header::AUTHORIZATION, request::Parts, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

use crate::context::ModuleContext;

pub struct ModuleApiError(orva_error::Error);

impl From<orva_error::Error> for ModuleApiError {
    fn from(err: orva_error::Error) -> Self {
        ModuleApiError(err)
    }
}

impl IntoResponse for ModuleApiError {
    fn into_response(self) -> Response {
        use orva_error::Error::*;
        let (status, message) = match &self.0 {
            NotFound(m) => (StatusCode::NOT_FOUND, m.clone()),
            Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized".to_string()),
            Forbidden(m) => (StatusCode::FORBIDDEN, m.clone()),
            Validation(m) => (StatusCode::BAD_REQUEST, m.clone()),
            Config(m) => (StatusCode::INTERNAL_SERVER_ERROR, m.clone()),
            Internal(m) => (StatusCode::INTERNAL_SERVER_ERROR, m.clone()),
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}

/// ระบุ permission key ตัวเดียวที่ route หนึ่งต้องการ — module ใหม่ implement trait นี้บน
/// marker type ของตัวเอง (เหมือนที่ orva-core ทำกับ `permissions.rs`) โดยไม่ต้องแก้โค้ด Core
pub trait PermissionKey {
    const KEY: &'static str;
}

/// ผูก permission key เข้ากับชื่อ module ที่เป็นเจ้าของ — เพื่อให้ extractor เช็คได้ทั้ง
/// "module นี้ถูก install/enable ให้องค์กรหรือยัง" และ "user มี permission นี้ไหม" ในจุดเดียว
pub trait ModulePermission: PermissionKey {
    const MODULE_NAME: &'static str;
}

pub struct ModuleUser(pub orva_data::User);

impl FromRequestParts<ModuleContext> for ModuleUser {
    type Rejection = ModuleApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        ctx: &ModuleContext,
    ) -> Result<Self, Self::Rejection> {
        let token = bearer_token(parts).ok_or(orva_error::Error::Unauthorized)?;
        let (_session, user) = ctx.auth.authenticate_session(&token).await?;
        Ok(ModuleUser(user))
    }
}

fn bearer_token(parts: &Parts) -> Option<String> {
    parts
        .headers
        .get(AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .map(str::to_string)
}

/// ต้อง login แล้ว **+** module ของ `K` ถูก install/enable ให้องค์กรนี้ **+** มี permission
/// `K::KEY` — สามอย่างในตัวเดียว (ดู [`ModulePermission`])
pub struct RequireModulePermission<K: ModulePermission>(pub orva_data::User, pub PhantomData<K>);

impl<K> FromRequestParts<ModuleContext> for RequireModulePermission<K>
where
    K: ModulePermission + Send + Sync,
{
    type Rejection = ModuleApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        ctx: &ModuleContext,
    ) -> Result<Self, Self::Rejection> {
        let ModuleUser(user) = ModuleUser::from_request_parts(parts, ctx).await?;

        let installed = ctx
            .installations
            .is_enabled(user.organization_id, K::MODULE_NAME)
            .await?;
        if !installed {
            return Err(orva_error::Error::Forbidden(format!(
                "module '{}' is not installed or disabled for this organization",
                K::MODULE_NAME
            ))
            .into());
        }

        ctx.auth
            .require_permission(user.organization_id, user.id, K::KEY)
            .await?;

        Ok(RequireModulePermission(user, PhantomData))
    }
}
