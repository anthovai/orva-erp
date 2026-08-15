use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use orva_error::{Error, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// ID token ตามแนวคิด OIDC — ยังใช้ HS256 (shared secret) ใน v0.1 เพราะยังไม่มี
/// relying party ภายนอกที่ต้อง verify ผ่าน JWKS สาธารณะ — ดู ADR สำหรับแผนย้ายไป RS256
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdTokenClaims {
    pub sub: Uuid,
    pub org: Uuid,
    pub email: String,
    pub name: String,
    pub iss: String,
    pub aud: String,
    pub iat: i64,
    pub exp: i64,
}

/// ข้อมูลผู้ใช้ที่จำเป็นสำหรับออก ID token — จัดกลุ่มเป็น struct เดียวแทนการรับ
/// parameter แยกกันหลายตัว (clippy::too_many_arguments)
pub struct IdTokenSubject<'a> {
    pub user_id: Uuid,
    pub organization_id: Uuid,
    pub email: &'a str,
    pub display_name: &'a str,
}

pub fn issue_id_token(
    secret: &[u8],
    issuer: &str,
    audience: &str,
    subject: IdTokenSubject<'_>,
    ttl: Duration,
) -> Result<String> {
    let now = Utc::now();
    let claims = IdTokenClaims {
        sub: subject.user_id,
        org: subject.organization_id,
        email: subject.email.to_string(),
        name: subject.display_name.to_string(),
        iss: issuer.to_string(),
        aud: audience.to_string(),
        iat: now.timestamp(),
        exp: (now + ttl).timestamp(),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret),
    )
    .map_err(|e| Error::Internal(format!("issue id_token failed: {e}")))
}

pub fn verify_id_token(secret: &[u8], token: &str, audience: &str) -> Result<IdTokenClaims> {
    let mut validation = Validation::default();
    validation.set_audience(&[audience]);

    decode::<IdTokenClaims>(token, &DecodingKey::from_secret(secret), &validation)
        .map(|data| data.claims)
        .map_err(|_| Error::Unauthorized)
}
