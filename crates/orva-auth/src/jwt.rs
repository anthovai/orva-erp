use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, Algorithm, Header, Validation};
use orva_error::{Error, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::keys::JwtKeys;

/// ID token ตามแนวคิด OIDC — เซ็นด้วย RS256 (ADR 0006) relying party ภายนอก verify
/// ผ่าน public key ใน `/.well-known/jwks.json` ได้โดยไม่ต้องแชร์ secret ใด ๆ
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
    keys: &JwtKeys,
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

    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some(keys.kid.clone());

    encode(&header, &claims, &keys.encoding)
        .map_err(|e| Error::Internal(format!("issue id_token failed: {e}")))
}

pub fn verify_id_token(keys: &JwtKeys, token: &str, audience: &str) -> Result<IdTokenClaims> {
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[audience]);

    decode::<IdTokenClaims>(token, &keys.decoding, &validation)
        .map(|data| data.claims)
        .map_err(|_| Error::Unauthorized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issue_and_verify_round_trip_rs256() {
        let (keys, _) = JwtKeys::generate().unwrap();
        let token = issue_id_token(
            &keys,
            "orva-core",
            "orva-core",
            IdTokenSubject {
                user_id: Uuid::new_v4(),
                organization_id: Uuid::new_v4(),
                email: "a@b.test",
                display_name: "A",
            },
            Duration::hours(1),
        )
        .unwrap();

        // header ต้องประกาศ RS256 + kid ตรงกับ JWKS
        let header = jsonwebtoken::decode_header(&token).unwrap();
        assert_eq!(header.alg, Algorithm::RS256);
        assert_eq!(header.kid.as_deref(), Some(keys.kid.as_str()));

        let claims = verify_id_token(&keys, &token, "orva-core").unwrap();
        assert_eq!(claims.iss, "orva-core");

        // key คนละคู่ต้อง verify ไม่ผ่าน
        let (other, _) = JwtKeys::generate().unwrap();
        assert!(verify_id_token(&other, &token, "orva-core").is_err());
    }
}
