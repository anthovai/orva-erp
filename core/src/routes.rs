use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;
use validator::Validate;

use crate::{
    error::ApiError,
    extractor::{AuthUser, RequirePermission},
    permissions::{EventRead, OrganizationManage, RoleManage, ServiceIdentityManage},
    state::AppState,
    validation::ValidatedJson,
};

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/health", get(health))
        .route(
            "/.well-known/openid-configuration",
            get(openid_configuration),
        )
        .route("/.well-known/jwks.json", get(jwks))
        .route("/api/v1/organizations", post(provision_organization))
        .route(
            "/api/v1/organizations/current/suspend",
            post(suspend_current_organization),
        )
        .route("/api/v1/auth/register", post(register))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/logout", post(logout))
        .route("/api/v1/auth/mfa/setup", post(mfa_setup))
        .route("/api/v1/auth/mfa/activate", post(mfa_activate))
        .route("/api/v1/auth/mfa/disable", post(mfa_disable))
        .route("/api/v1/auth/me", get(me))
        .route("/api/v1/auth/me/permissions", get(my_permissions))
        .route("/api/v1/auth/userinfo", get(userinfo))
        .route("/api/v1/service-identities", post(create_service_identity))
        .route("/api/v1/roles", post(create_role))
        .route(
            "/api/v1/roles/{role_id}/permissions",
            post(grant_role_permission),
        )
        .route("/api/v1/roles/{role_id}/assign", post(assign_role))
        .route("/api/v1/events", get(list_events))
}

#[utoipa::path(get, path = "/health", tag = "system",
    responses((status = 200, description = "ORVA Core is up")))]
pub(crate) async fn health() -> Json<serde_json::Value> {
    Json(json!({
        "status": "ok",
        "service": "orva-core",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

/// OIDC discovery document — foundation ตาม ARCHITECTURE.md §2
/// ยังไม่มี `authorization_endpoint` แบบ redirect flow เต็มรูปแบบ เพราะยังไม่มี
/// relying party (OSS module) จริงให้ทดสอบ SSO — ดู MILESTONES.md M2
#[utoipa::path(get, path = "/.well-known/openid-configuration", tag = "system",
    responses((status = 200, description = "OIDC discovery document")))]
pub(crate) async fn openid_configuration(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "issuer": state.issuer,
        "token_endpoint": "/api/v1/auth/login",
        "userinfo_endpoint": "/api/v1/auth/userinfo",
        "jwks_uri": "/.well-known/jwks.json",
        "id_token_signing_alg_values_supported": ["RS256"],
    }))
}

/// JWKS สาธารณะ (ADR 0006) — relying party ภายนอกใช้ verify ลายเซ็น ID token
/// โดยไม่ต้องแชร์ secret ใด ๆ กับ ORVA
#[utoipa::path(get, path = "/.well-known/jwks.json", tag = "system",
    responses((status = 200, description = "JSON Web Key Set (public signing keys)")))]
pub(crate) async fn jwks(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(state.jwks.clone())
}

#[derive(Serialize, ToSchema)]
pub(crate) struct TokenResponse {
    access_token: String,
    id_token: String,
    token_type: &'static str,
    expires_in: i64,
}

impl From<orva_auth::AuthResult> for TokenResponse {
    fn from(r: orva_auth::AuthResult) -> Self {
        Self {
            access_token: r.session_token,
            id_token: r.id_token,
            token_type: "Bearer",
            expires_in: r.expires_in_seconds,
        }
    }
}

#[derive(Deserialize, Validate, ToSchema)]
pub(crate) struct ProvisionOrganizationRequest {
    #[validate(length(min = 1))]
    name: String,
    #[validate(length(min = 1))]
    slug: String,
    #[validate(email)]
    owner_email: String,
    #[validate(length(min = 1))]
    owner_display_name: String,
    #[validate(length(min = 8))]
    owner_password: String,
}

/// Tenant provisioning (M3) — สร้าง organization + owner + role "owner" (ทุก permission) แล้ว login ให้ทันที
/// เป็น route สาธารณะ (self-service signup) ตั้งใจไม่ต้อง auth มาก่อน
#[utoipa::path(post, path = "/api/v1/organizations", tag = "tenant",
    request_body = ProvisionOrganizationRequest,
    responses((status = 201, description = "Organization created, tokens issued", body = TokenResponse)))]
pub(crate) async fn provision_organization(
    State(state): State<AppState>,
    ValidatedJson(body): ValidatedJson<ProvisionOrganizationRequest>,
) -> Result<(StatusCode, Json<TokenResponse>), ApiError> {
    let result = state
        .auth
        .provision_organization(
            &body.name,
            &body.slug,
            &body.owner_email,
            &body.owner_display_name,
            &body.owner_password,
        )
        .await?;
    Ok((StatusCode::CREATED, Json(result.into())))
}

#[utoipa::path(post, path = "/api/v1/organizations/current/suspend", tag = "tenant",
    security(("bearer" = [])),
    responses((status = 204, description = "Organization suspended"), (status = 403, description = "Missing core.organization.manage")))]
pub(crate) async fn suspend_current_organization(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<OrganizationManage>,
) -> Result<StatusCode, ApiError> {
    state
        .auth
        .suspend_organization(user.organization_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, Validate, ToSchema)]
pub(crate) struct RegisterRequest {
    #[validate(length(min = 1))]
    organization_slug: String,
    #[validate(email)]
    email: String,
    #[validate(length(min = 1))]
    display_name: String,
    #[validate(length(min = 8))]
    password: String,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct UserResponse {
    id: Uuid,
    organization_id: Uuid,
    email: String,
    display_name: String,
}

impl From<orva_data::User> for UserResponse {
    fn from(u: orva_data::User) -> Self {
        Self {
            id: u.id,
            organization_id: u.organization_id,
            email: u.email,
            display_name: u.display_name,
        }
    }
}

/// เพิ่มสมาชิกเข้าองค์กรที่มีอยู่แล้ว (ไม่ได้มี role ใด ๆ ให้อัตโนมัติ — ต้องให้เจ้าของ
/// องค์กร assign role ทีหลังผ่าน `/api/v1/roles/{role_id}/assign`)
#[utoipa::path(post, path = "/api/v1/auth/register", tag = "auth",
    request_body = RegisterRequest,
    responses((status = 201, description = "Member added to organization", body = UserResponse)))]
pub(crate) async fn register(
    State(state): State<AppState>,
    ValidatedJson(body): ValidatedJson<RegisterRequest>,
) -> Result<(StatusCode, Json<UserResponse>), ApiError> {
    let user = state
        .auth
        .register(
            &body.organization_slug,
            &body.email,
            &body.display_name,
            &body.password,
        )
        .await?;
    Ok((StatusCode::CREATED, Json(user.into())))
}

#[derive(Deserialize, Validate, ToSchema)]
pub(crate) struct LoginRequest {
    #[validate(length(min = 1))]
    organization_slug: String,
    #[validate(email)]
    email: String,
    #[validate(length(min = 1))]
    password: String,
    /// จำเป็นเมื่อ user เปิด MFA — ไม่ส่งมาจะได้ 400 `totp_code required` (ADR 0007)
    totp_code: Option<String>,
}

#[utoipa::path(post, path = "/api/v1/auth/login", tag = "auth",
    request_body = LoginRequest,
    responses((status = 200, description = "Session + ID token issued", body = TokenResponse),
               (status = 400, description = "MFA enabled but totp_code missing"),
               (status = 401, description = "Invalid credentials or wrong TOTP code")))]
pub(crate) async fn login(
    State(state): State<AppState>,
    ValidatedJson(body): ValidatedJson<LoginRequest>,
) -> Result<Json<TokenResponse>, ApiError> {
    let result = state
        .auth
        .login(
            &body.organization_slug,
            &body.email,
            &body.password,
            body.totp_code.as_deref(),
        )
        .await?;
    Ok(Json(result.into()))
}

#[derive(Serialize, ToSchema)]
pub(crate) struct MfaSetupResponse {
    /// secret แบบ base32 — โชว์ครั้งเดียวตอน setup ให้ user กรอกมือได้ถ้าสแกน QR ไม่ได้
    secret: String,
    /// เนื้อหาสำหรับทำ QR code ให้ authenticator app สแกน
    otpauth_uri: String,
}

/// เริ่ม setup MFA (pending จนกว่าจะ activate) — เรียกซ้ำ = ออก secret ใหม่แทนอันเดิม
#[utoipa::path(post, path = "/api/v1/auth/mfa/setup", tag = "auth",
    security(("bearer" = [])),
    responses((status = 200, description = "TOTP secret issued (pending activation)", body = MfaSetupResponse)))]
pub(crate) async fn mfa_setup(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Json<MfaSetupResponse>, ApiError> {
    let (secret, otpauth_uri) = state.auth.mfa_setup(user.organization_id, user.id).await?;
    Ok(Json(MfaSetupResponse {
        secret,
        otpauth_uri,
    }))
}

#[derive(Deserialize, Validate, ToSchema)]
pub(crate) struct MfaCodeRequest {
    #[validate(length(min = 6, max = 6))]
    code: String,
}

/// ยืนยัน code แรกจาก authenticator app → MFA ถูกบังคับตอน login นับจากนี้
#[utoipa::path(post, path = "/api/v1/auth/mfa/activate", tag = "auth",
    security(("bearer" = [])), request_body = MfaCodeRequest,
    responses((status = 204, description = "MFA activated"),
               (status = 401, description = "Wrong TOTP code")))]
pub(crate) async fn mfa_activate(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    ValidatedJson(body): ValidatedJson<MfaCodeRequest>,
) -> Result<StatusCode, ApiError> {
    state
        .auth
        .mfa_activate(user.organization_id, user.id, &body.code)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// ปิด MFA — ต้องยืนยัน code ปัจจุบัน (session ที่ถูกขโมยปิด MFA เองไม่ได้)
#[utoipa::path(post, path = "/api/v1/auth/mfa/disable", tag = "auth",
    security(("bearer" = [])), request_body = MfaCodeRequest,
    responses((status = 204, description = "MFA disabled"),
               (status = 401, description = "Wrong TOTP code")))]
pub(crate) async fn mfa_disable(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    ValidatedJson(body): ValidatedJson<MfaCodeRequest>,
) -> Result<StatusCode, ApiError> {
    state
        .auth
        .mfa_disable(user.organization_id, user.id, &body.code)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(post, path = "/api/v1/auth/logout", tag = "auth",
    security(("bearer" = [])),
    responses((status = 204, description = "Session revoked")))]
pub(crate) async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    let token = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(orva_error::Error::Unauthorized)?;

    state.auth.logout(token).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(get, path = "/api/v1/auth/me", tag = "auth",
    security(("bearer" = [])),
    responses((status = 200, description = "Current user", body = UserResponse)))]
pub(crate) async fn me(AuthUser(user): AuthUser) -> Json<UserResponse> {
    Json(user.into())
}

#[utoipa::path(get, path = "/api/v1/auth/me/permissions", tag = "auth",
    security(("bearer" = [])),
    responses((status = 200, description = "Permission keys held by current user", body = [String])))]
pub(crate) async fn my_permissions(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Json<Vec<String>>, ApiError> {
    let permissions = state
        .auth
        .permissions_for(user.organization_id, user.id)
        .await?;
    Ok(Json(permissions.into_keys()))
}

/// OIDC userinfo-equivalent — เนื้อหาเหมือน `/me` ตอนนี้ เพราะยังไม่มี scope/claims request จริง
#[utoipa::path(get, path = "/api/v1/auth/userinfo", tag = "auth",
    security(("bearer" = [])),
    responses((status = 200, description = "OIDC-style userinfo claims")))]
pub(crate) async fn userinfo(AuthUser(user): AuthUser) -> Json<serde_json::Value> {
    Json(json!({
        "sub": user.id,
        "org": user.organization_id,
        "email": user.email,
        "name": user.display_name,
    }))
}

#[derive(Deserialize, Validate, ToSchema)]
pub(crate) struct CreateServiceIdentityRequest {
    #[validate(length(min = 1))]
    name: String,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct ServiceIdentityResponse {
    id: Uuid,
    name: String,
    api_key: String,
}

#[utoipa::path(post, path = "/api/v1/service-identities", tag = "identity",
    security(("bearer" = [])),
    request_body = CreateServiceIdentityRequest,
    responses((status = 201, description = "Service identity issued (api_key shown once)", body = ServiceIdentityResponse),
               (status = 403, description = "Missing core.service_identity.manage")))]
pub(crate) async fn create_service_identity(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<ServiceIdentityManage>,
    ValidatedJson(body): ValidatedJson<CreateServiceIdentityRequest>,
) -> Result<(StatusCode, Json<ServiceIdentityResponse>), ApiError> {
    let (identity, raw_key) = state
        .auth
        .issue_service_identity(user.organization_id, &body.name, user.id)
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(ServiceIdentityResponse {
            id: identity.id,
            name: identity.name,
            api_key: raw_key,
        }),
    ))
}

#[derive(Deserialize, Validate, ToSchema)]
pub(crate) struct CreateRoleRequest {
    #[validate(length(min = 1))]
    name: String,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct RoleResponse {
    id: Uuid,
    name: String,
}

impl From<orva_data::Role> for RoleResponse {
    fn from(r: orva_data::Role) -> Self {
        Self {
            id: r.id,
            name: r.name,
        }
    }
}

#[utoipa::path(post, path = "/api/v1/roles", tag = "authorization",
    security(("bearer" = [])),
    request_body = CreateRoleRequest,
    responses((status = 201, description = "Role created", body = RoleResponse),
               (status = 403, description = "Missing core.role.manage")))]
pub(crate) async fn create_role(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<RoleManage>,
    ValidatedJson(body): ValidatedJson<CreateRoleRequest>,
) -> Result<(StatusCode, Json<RoleResponse>), ApiError> {
    let role = state
        .auth
        .create_role(user.organization_id, &body.name, user.id)
        .await?;
    Ok((StatusCode::CREATED, Json(role.into())))
}

#[derive(Deserialize, Validate, ToSchema)]
pub(crate) struct GrantPermissionRequest {
    #[validate(length(min = 1))]
    permission_key: String,
}

/// role_id ที่ไม่ได้อยู่ใน organization ของผู้เรียกจะได้ 404 (ดู `AuthService::grant_role_permission`) — กัน cross-tenant privilege escalation
#[utoipa::path(post, path = "/api/v1/roles/{role_id}/permissions", tag = "authorization",
    security(("bearer" = [])),
    params(("role_id" = Uuid, Path, description = "Role id (ต้องอยู่ใน organization ของผู้เรียก)")),
    request_body = GrantPermissionRequest,
    responses((status = 204, description = "Permission granted"),
               (status = 404, description = "Role not found in caller's organization")))]
pub(crate) async fn grant_role_permission(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<RoleManage>,
    Path(role_id): Path<Uuid>,
    ValidatedJson(body): ValidatedJson<GrantPermissionRequest>,
) -> Result<StatusCode, ApiError> {
    state
        .auth
        .grant_role_permission(user.organization_id, role_id, &body.permission_key)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct AssignRoleRequest {
    user_id: Uuid,
}

/// role_id หรือ user_id ข้าม organization จะได้ 404 (ดู `AuthService::assign_role`) — กัน cross-tenant privilege escalation
#[utoipa::path(post, path = "/api/v1/roles/{role_id}/assign", tag = "authorization",
    security(("bearer" = [])),
    params(("role_id" = Uuid, Path, description = "Role id (ต้องอยู่ใน organization ของผู้เรียก)")),
    request_body = AssignRoleRequest,
    responses((status = 204, description = "Role assigned"),
               (status = 404, description = "Role or user not found in caller's organization")))]
pub(crate) async fn assign_role(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<RoleManage>,
    Path(role_id): Path<Uuid>,
    Json(body): Json<AssignRoleRequest>,
) -> Result<StatusCode, ApiError> {
    state
        .auth
        .assign_role(user.organization_id, role_id, body.user_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// M6 DoD: "Audit query API (filter ตาม user/resource/ช่วงเวลา)" — ทุก field optional
#[derive(Deserialize, IntoParams)]
pub(crate) struct ListEventsQuery {
    /// filter ตาม event type เช่น `role.created`
    event_type: Option<String>,
    /// filter ตามคนทำ (actor) — "user" ใน "ใคร ทำอะไร กับอะไร เมื่อไหร่"
    actor_user_id: Option<Uuid>,
    /// filter ตามชนิด resource เช่น `role`, `invoice` — "อะไร"
    resource_type: Option<String>,
    /// filter ตาม resource id เจาะจง
    resource_id: Option<Uuid>,
    /// ช่วงเวลาเริ่มต้น (inclusive) — "เมื่อไหร่"
    occurred_from: Option<DateTime<Utc>>,
    /// ช่วงเวลาสิ้นสุด (inclusive)
    occurred_to: Option<DateTime<Utc>>,
    #[serde(default = "default_event_limit")]
    limit: i64,
}

fn default_event_limit() -> i64 {
    50
}

#[derive(Serialize, ToSchema)]
pub(crate) struct EventResponse {
    id: Uuid,
    event_type: String,
    payload: serde_json::Value,
    actor_user_id: Option<Uuid>,
    correlation_id: Uuid,
    occurred_at: DateTime<Utc>,
    resource_type: Option<String>,
    resource_id: Option<Uuid>,
}

impl From<orva_data::Event> for EventResponse {
    fn from(e: orva_data::Event) -> Self {
        Self {
            id: e.id,
            event_type: e.event_type,
            payload: e.payload,
            actor_user_id: e.actor_user_id,
            correlation_id: e.correlation_id,
            occurred_at: e.occurred_at,
            resource_type: e.resource_type,
            resource_id: e.resource_id,
        }
    }
}

/// M5/M6 DoD: "event ทุกตัวถูก persist และ query ย้อนหลังได้" + "Audit trail จาก event log" —
/// endpoint นี้คือทางเข้าจริงผ่าน API เรียงล่าสุดก่อนเสมอ, filter เฉพาะองค์กรของผู้เรียก
#[utoipa::path(get, path = "/api/v1/events", tag = "events",
    security(("bearer" = [])),
    params(ListEventsQuery),
    responses((status = 200, description = "Event/audit log ย้อนหลังขององค์กร (ล่าสุดก่อน)", body = [EventResponse]),
               (status = 403, description = "Missing core.event.read")))]
pub(crate) async fn list_events(
    State(state): State<AppState>,
    RequirePermission(user, ..): RequirePermission<EventRead>,
    Query(query): Query<ListEventsQuery>,
) -> Result<Json<Vec<EventResponse>>, ApiError> {
    let events = state
        .events
        .list(
            user.organization_id,
            orva_data::EventFilter {
                event_type: query.event_type.as_deref(),
                actor_user_id: query.actor_user_id,
                resource_type: query.resource_type.as_deref(),
                resource_id: query.resource_id,
                occurred_from: query.occurred_from,
                occurred_to: query.occurred_to,
            },
            query.limit,
        )
        .await?;
    Ok(Json(events.into_iter().map(EventResponse::from).collect()))
}
