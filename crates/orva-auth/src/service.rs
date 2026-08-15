use chrono::{Duration, Utc};
use orva_data::{
    OrganizationRepository, PermissionRepository, Pool, Role, RoleRepository,
    ServiceIdentityRepository, Session, SessionRepository, User, UserRepository,
};
use orva_error::{Error, Result};
use orva_events::{catalog, EventBus, PublishOptions};
use serde_json::json;
use uuid::Uuid;

use crate::{
    authz::{Authorizer, PermissionSet},
    jwt, password, token, totp,
};

/// role เริ่มต้นที่ผู้ก่อตั้งองค์กรได้รับตอน provisioning — ถือ permission ทุกตัวใน catalog
const OWNER_ROLE_NAME: &str = "owner";

const SESSION_TTL_HOURS: i64 = 24;

pub struct AuthConfig {
    /// RSA key pair สำหรับเซ็น/verify ID token (RS256 — ADR 0006)
    pub keys: crate::keys::JwtKeys,
    pub issuer: String,
}

/// ผลของ login/register สำเร็จ — ครบทั้ง session token (สำหรับเรียก ORVA API)
/// และ id_token แบบ OIDC (สำหรับ relying party ภายนอกในอนาคต)
pub struct AuthResult {
    pub user: User,
    pub session_token: String,
    pub id_token: String,
    pub expires_in_seconds: i64,
}

pub struct AuthService {
    organizations: OrganizationRepository,
    users: UserRepository,
    sessions: SessionRepository,
    service_identities: ServiceIdentityRepository,
    roles: RoleRepository,
    permissions: PermissionRepository,
    events: EventBus,
    config: AuthConfig,
}

impl AuthService {
    pub fn new(pool: Pool, config: AuthConfig, events: EventBus) -> Self {
        Self {
            organizations: OrganizationRepository::new(pool.clone()),
            users: UserRepository::new(pool.clone()),
            sessions: SessionRepository::new(pool.clone()),
            service_identities: ServiceIdentityRepository::new(pool.clone()),
            roles: RoleRepository::new(pool.clone()),
            permissions: PermissionRepository::new(pool),
            events,
            config,
        }
    }

    /// Tenant provisioning: สร้าง organization + ผู้ก่อตั้ง + role "owner" ที่มีทุก permission
    /// ในคราวเดียว (atomic ในความหมาย application-level — ยังไม่ได้ wrap เป็น DB transaction
    /// เดียว ดู MILESTONES.md M3 สำหรับ known gap นี้) แล้ว login ให้ทันที
    pub async fn provision_organization(
        &self,
        name: &str,
        slug: &str,
        owner_email: &str,
        owner_display_name: &str,
        owner_password: &str,
    ) -> Result<AuthResult> {
        let org = self.organizations.create(name, slug).await?;

        let password_hash = password::hash_password(owner_password)?;
        let user = self
            .users
            .create(
                org.id,
                owner_email,
                owner_display_name,
                &password_hash,
                None,
            )
            .await?;

        let owner_role = self
            .roles
            .create(org.id, OWNER_ROLE_NAME, Some(user.id))
            .await?;
        for permission in self.permissions.list().await? {
            self.roles
                .grant_permission(org.id, owner_role.id, permission.id)
                .await?;
        }
        self.roles
            .assign_to_user(org.id, owner_role.id, user.id)
            .await?;

        self.events
            .publish(
                org.id,
                catalog::ORGANIZATION_PROVISIONED,
                json!({ "organization_id": org.id, "slug": org.slug, "owner_user_id": user.id }),
                PublishOptions {
                    actor_user_id: Some(user.id),
                    resource: Some(("organization".to_string(), org.id)),
                    ..Default::default()
                },
            )
            .await?;

        self.issue_tokens(&user).await
    }

    pub async fn suspend_organization(&self, organization_id: Uuid) -> Result<()> {
        self.organizations.soft_delete(organization_id).await?;
        self.events
            .publish(
                organization_id,
                catalog::ORGANIZATION_SUSPENDED,
                json!({ "organization_id": organization_id }),
                PublishOptions {
                    resource: Some(("organization".to_string(), organization_id)),
                    ..Default::default()
                },
            )
            .await?;
        Ok(())
    }

    pub async fn create_role(
        &self,
        organization_id: Uuid,
        name: &str,
        created_by: Uuid,
    ) -> Result<Role> {
        let role = self
            .roles
            .create(organization_id, name, Some(created_by))
            .await?;
        self.events
            .publish(
                organization_id,
                catalog::ROLE_CREATED,
                json!({ "role_id": role.id, "name": role.name }),
                PublishOptions {
                    actor_user_id: Some(created_by),
                    resource: Some(("role".to_string(), role.id)),
                    ..Default::default()
                },
            )
            .await?;
        Ok(role)
    }

    pub async fn grant_role_permission(
        &self,
        organization_id: Uuid,
        role_id: Uuid,
        permission_key: &str,
    ) -> Result<()> {
        self.roles
            .find_by_id(organization_id, role_id)
            .await?
            .ok_or_else(|| Error::NotFound(format!("role '{role_id}'")))?;

        let permission = self
            .permissions
            .find_by_key(permission_key)
            .await?
            .ok_or_else(|| Error::Validation(format!("unknown permission '{permission_key}'")))?;

        self.roles
            .grant_permission(organization_id, role_id, permission.id)
            .await
    }

    /// มอบ role ให้ user — ทั้ง role และ user ต้องอยู่ใน organization เดียวกับผู้เรียก
    /// (กัน cross-tenant privilege escalation) — ดู `core/tests/authz_flow.rs`
    pub async fn assign_role(
        &self,
        organization_id: Uuid,
        role_id: Uuid,
        target_user_id: Uuid,
    ) -> Result<()> {
        self.roles
            .find_by_id(organization_id, role_id)
            .await?
            .ok_or_else(|| Error::NotFound(format!("role '{role_id}'")))?;
        self.users
            .find_by_id(organization_id, target_user_id)
            .await?
            .ok_or_else(|| Error::NotFound(format!("user '{target_user_id}'")))?;

        self.roles
            .assign_to_user(organization_id, role_id, target_user_id)
            .await?;

        self.events
            .publish(
                organization_id,
                catalog::ROLE_ASSIGNED,
                json!({ "role_id": role_id, "user_id": target_user_id }),
                PublishOptions {
                    resource: Some(("role".to_string(), role_id)),
                    ..Default::default()
                },
            )
            .await?;
        Ok(())
    }

    pub async fn permissions_for(
        &self,
        organization_id: Uuid,
        user_id: Uuid,
    ) -> Result<PermissionSet> {
        let keys = self
            .roles
            .permission_keys_for_user(organization_id, user_id)
            .await?;
        Ok(PermissionSet::new(keys))
    }

    /// คืน `Error::Forbidden` ถ้า user ไม่มี permission key นี้ในองค์กรของตัวเอง
    pub async fn require_permission(
        &self,
        organization_id: Uuid,
        user_id: Uuid,
        permission_key: &str,
    ) -> Result<()> {
        let permissions = self.permissions_for(organization_id, user_id).await?;
        if Authorizer::check(&permissions, permission_key, None) {
            Ok(())
        } else {
            Err(Error::Forbidden(format!(
                "missing permission '{permission_key}'"
            )))
        }
    }

    pub async fn register(
        &self,
        organization_slug: &str,
        email: &str,
        display_name: &str,
        plain_password: &str,
    ) -> Result<User> {
        let org = self
            .organizations
            .find_by_slug(organization_slug)
            .await?
            .ok_or_else(|| Error::NotFound(format!("organization '{organization_slug}'")))?;

        let password_hash = password::hash_password(plain_password)?;
        let user = self
            .users
            .create(org.id, email, display_name, &password_hash, None)
            .await?;

        self.events
            .publish(
                org.id,
                catalog::USER_REGISTERED,
                json!({ "user_id": user.id, "email": user.email }),
                PublishOptions {
                    actor_user_id: Some(user.id),
                    resource: Some(("user".to_string(), user.id)),
                    ..Default::default()
                },
            )
            .await?;

        Ok(user)
    }

    pub async fn login(
        &self,
        organization_slug: &str,
        email: &str,
        plain_password: &str,
        totp_code: Option<&str>,
    ) -> Result<AuthResult> {
        let org = self
            .organizations
            .find_by_slug(organization_slug)
            .await?
            .ok_or(Error::Unauthorized)?;

        let user = self
            .find_user_by_email(org.id, email)
            .await?
            .ok_or(Error::Unauthorized)?;

        if !password::verify_password(plain_password, &user.password_hash)? {
            return Err(Error::Unauthorized);
        }

        // MFA: เช็คหลังรหัสผ่านถูกเท่านั้น — ไม่ leak ว่า user ไหนเปิด MFA ให้คนเดารหัส
        if user.mfa_enabled {
            let secret = user
                .mfa_secret
                .as_deref()
                .ok_or_else(|| Error::Internal("mfa enabled but no secret stored".to_string()))?;
            match totp_code {
                // แยก error ให้ client รู้ว่าต้องถาม code (รหัสผ่านผ่านแล้ว) — ดู ADR 0007
                None => return Err(Error::Validation("totp_code required".to_string())),
                Some(code) => {
                    if !totp::verify(secret, code)? {
                        return Err(Error::Unauthorized);
                    }
                }
            }
        }

        self.issue_tokens(&user).await
    }

    /// เริ่ม setup MFA: สร้าง secret ใหม่เก็บแบบ pending (ยังไม่บังคับตอน login)
    /// จนกว่าจะยืนยัน code แรกผ่าน [`Self::mfa_activate`] — กัน user ล็อกตัวเอง
    /// ออกจากระบบเพราะยังไม่ทันสแกน QR
    pub async fn mfa_setup(
        &self,
        organization_id: Uuid,
        user_id: Uuid,
    ) -> Result<(String, String)> {
        let user = self
            .users
            .find_by_id(organization_id, user_id)
            .await?
            .ok_or_else(|| Error::NotFound(format!("user '{user_id}'")))?;

        let (secret, otpauth_uri) = totp::generate(&self.config.issuer, &user.email)?;
        self.users
            .set_mfa_secret(organization_id, user_id, &secret)
            .await?;
        Ok((secret, otpauth_uri))
    }

    /// ยืนยัน code แรกจาก authenticator app → เปิดบังคับ MFA ตอน login จริง
    pub async fn mfa_activate(
        &self,
        organization_id: Uuid,
        user_id: Uuid,
        code: &str,
    ) -> Result<()> {
        let user = self
            .users
            .find_by_id(organization_id, user_id)
            .await?
            .ok_or_else(|| Error::NotFound(format!("user '{user_id}'")))?;
        let secret = user.mfa_secret.as_deref().ok_or_else(|| {
            Error::Validation("no pending mfa setup — call setup first".to_string())
        })?;

        if !totp::verify(secret, code)? {
            return Err(Error::Unauthorized);
        }

        self.users
            .set_mfa_enabled(organization_id, user_id, true)
            .await?;
        self.events
            .publish(
                organization_id,
                catalog::USER_MFA_ENABLED,
                json!({ "user_id": user_id }),
                PublishOptions {
                    actor_user_id: Some(user_id),
                    resource: Some(("user".to_string(), user_id)),
                    ..Default::default()
                },
            )
            .await?;
        Ok(())
    }

    /// ปิด MFA — ต้องยืนยัน code ปัจจุบันก่อน (session ที่ถูกขโมยจะปิด MFA เองไม่ได้)
    pub async fn mfa_disable(
        &self,
        organization_id: Uuid,
        user_id: Uuid,
        code: &str,
    ) -> Result<()> {
        let user = self
            .users
            .find_by_id(organization_id, user_id)
            .await?
            .ok_or_else(|| Error::NotFound(format!("user '{user_id}'")))?;
        if !user.mfa_enabled {
            return Err(Error::Validation("mfa is not enabled".to_string()));
        }
        let secret = user
            .mfa_secret
            .as_deref()
            .ok_or_else(|| Error::Internal("mfa enabled but no secret stored".to_string()))?;

        if !totp::verify(secret, code)? {
            return Err(Error::Unauthorized);
        }

        self.users
            .set_mfa_enabled(organization_id, user_id, false)
            .await?;
        self.events
            .publish(
                organization_id,
                catalog::USER_MFA_DISABLED,
                json!({ "user_id": user_id }),
                PublishOptions {
                    actor_user_id: Some(user_id),
                    resource: Some(("user".to_string(), user_id)),
                    ..Default::default()
                },
            )
            .await?;
        Ok(())
    }

    async fn find_user_by_email(&self, organization_id: Uuid, email: &str) -> Result<Option<User>> {
        // M2 มีแค่ list — ยังไม่ต้องการ index พิเศษสำหรับ email lookup จนกว่าจะมี user จำนวนมาก (M3+)
        let users = self.users.list(organization_id).await?;
        Ok(users.into_iter().find(|u| u.email == email))
    }

    async fn issue_tokens(&self, user: &User) -> Result<AuthResult> {
        let ttl = Duration::hours(SESSION_TTL_HOURS);
        let raw_token = token::generate();
        let expires_at = Utc::now() + ttl;

        self.sessions
            .create(
                user.organization_id,
                user.id,
                &token::hash(&raw_token),
                expires_at,
            )
            .await?;

        let id_token = jwt::issue_id_token(
            &self.config.keys,
            &self.config.issuer,
            "orva-core",
            jwt::IdTokenSubject {
                user_id: user.id,
                organization_id: user.organization_id,
                email: &user.email,
                display_name: &user.display_name,
            },
            ttl,
        )?;

        Ok(AuthResult {
            user: user.clone(),
            session_token: raw_token,
            id_token,
            expires_in_seconds: ttl.num_seconds(),
        })
    }

    /// ตรวจ session token ที่ client ส่งมาใน `Authorization: Bearer <token>`
    pub async fn authenticate_session(&self, raw_token: &str) -> Result<(Session, User)> {
        let session = self
            .sessions
            .find_by_token_hash(&token::hash(raw_token))
            .await?
            .ok_or(Error::Unauthorized)?;

        if !session.is_active(Utc::now()) {
            return Err(Error::Unauthorized);
        }

        let user = self
            .users
            .find_by_id(session.organization_id, session.user_id)
            .await?
            .ok_or(Error::Unauthorized)?;

        Ok((session, user))
    }

    pub async fn logout(&self, raw_token: &str) -> Result<()> {
        if let Some(session) = self
            .sessions
            .find_by_token_hash(&token::hash(raw_token))
            .await?
        {
            self.sessions
                .revoke(session.organization_id, session.id)
                .await?;
        }
        Ok(())
    }

    /// ออก API key ให้ module/worker (ORVA Agent API ในอนาคต — ARCHITECTURE.md §12)
    /// คืน raw key ครั้งเดียวตอนสร้าง — หลังจากนี้เก็บได้แค่ hash เท่านั้น
    pub async fn issue_service_identity(
        &self,
        organization_id: Uuid,
        name: &str,
        created_by: Uuid,
    ) -> Result<(orva_data::ServiceIdentity, String)> {
        let raw_key = token::generate();
        let identity = self
            .service_identities
            .create(
                organization_id,
                name,
                &token::hash(&raw_key),
                Some(created_by),
            )
            .await?;

        self.events
            .publish(
                organization_id,
                catalog::SERVICE_IDENTITY_ISSUED,
                json!({ "service_identity_id": identity.id, "name": identity.name }),
                PublishOptions {
                    actor_user_id: Some(created_by),
                    resource: Some(("service_identity".to_string(), identity.id)),
                    ..Default::default()
                },
            )
            .await?;

        Ok((identity, raw_key))
    }

    /// ตรวจ service identity key ที่ module/worker ส่งมาใน `X-Orva-Service-Key`
    pub async fn authenticate_service_key(
        &self,
        raw_key: &str,
    ) -> Result<orva_data::ServiceIdentity> {
        let identity = self
            .service_identities
            .find_by_key_hash(&token::hash(raw_key))
            .await?
            .ok_or(Error::Unauthorized)?;

        if !identity.is_active() {
            return Err(Error::Unauthorized);
        }

        Ok(identity)
    }
}
