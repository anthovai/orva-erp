use std::marker::PhantomData;

use axum::extract::FromRequestParts;
use axum::http::{header::AUTHORIZATION, request::Parts};

use crate::{error::ApiError, state::AppState};

const SERVICE_KEY_HEADER: &str = "x-orva-service-key";

pub struct AuthUser(pub orva_data::User);

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = bearer_token(parts).ok_or(orva_error::Error::Unauthorized)?;
        let (_session, user) = state.auth.authenticate_session(&token).await?;
        // per-tenant rate limit (ADR 0012) — บังคับตรงนี้เพราะเพิ่งรู้ organization
        state.tenant_limiter.check(user.organization_id).await?;
        Ok(AuthUser(user))
    }
}

pub fn bearer_token(parts: &Parts) -> Option<String> {
    parts
        .headers
        .get(AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .map(str::to_string)
}

/// Permission key ที่ route หนึ่งต้องการ — implement บน marker type ว่าง ๆ ต่อ permission
/// (ดู `permissions.rs`) แทนการรับ string มา runtime เพื่อให้ compiler เช็ค route ↔ permission
/// ตรงกันตอน compile
pub trait PermissionKey {
    const KEY: &'static str;
}

/// Extractor: ต้อง login แล้ว **และ** มี permission `K::KEY` ในองค์กรของตัวเอง ไม่งั้น 403
///
/// ใช้แทน `AuthUser` ตรง ๆ ในทุก route ที่แก้ไข/สร้าง resource ระดับองค์กร (ไม่ใช่ route
/// ที่แค่ "อ่านข้อมูลตัวเอง" เช่น `/me` ซึ่งไม่ต้องมี permission พิเศษ)
pub struct RequirePermission<K: PermissionKey>(pub orva_data::User, pub PhantomData<K>);

impl<K> FromRequestParts<AppState> for RequirePermission<K>
where
    K: PermissionKey + Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let AuthUser(user) = AuthUser::from_request_parts(parts, state).await?;
        state
            .auth
            .require_permission(user.organization_id, user.id, K::KEY)
            .await?;
        Ok(RequirePermission(user, PhantomData))
    }
}

/// ORVA Agent API (M8) — auth ด้วย `X-Orva-Service-Key` แทน session token ของ user
///
/// identity ผูกกับ `organization_id` เดียวตั้งแต่ตอนออก key (tenant-scoped) และตั้งแต่
/// ADR 0011 แต่ละ key มี **fine-grained scope** กำกับด้วยว่าทำอะไรใน Agent API ได้บ้าง
/// (บังคับที่ route แต่ละตัว — ดู `routes_agent.rs`)
pub struct ServiceIdentityAuth(pub orva_data::ServiceIdentity);

impl FromRequestParts<AppState> for ServiceIdentityAuth {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let key = parts
            .headers
            .get(SERVICE_KEY_HEADER)
            .and_then(|v| v.to_str().ok())
            .ok_or(orva_error::Error::Unauthorized)?;
        let identity = state.auth.authenticate_service_key(key).await?;
        // per-tenant rate limit (ADR 0012) — agent ก็นับรวมใน quota ขององค์กรเดียวกัน
        state.tenant_limiter.check(identity.organization_id).await?;
        Ok(ServiceIdentityAuth(identity))
    }
}
