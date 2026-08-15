//! RSA key pair สำหรับเซ็น ID token แบบ RS256 + JWK สาธารณะสำหรับ `/.well-known/jwks.json`
//! — ดู ADR 0006 (แทนที่ HS256 shared secret ของ ADR 0002)

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use jsonwebtoken::{DecodingKey, EncodingKey};
use orva_error::{Error, Result};
use rsa::pkcs8::{DecodePrivateKey, EncodePrivateKey, LineEnding};
use rsa::traits::PublicKeyParts;
use rsa::{RsaPrivateKey, RsaPublicKey};
use sha2::{Digest, Sha256};

const RSA_BITS: usize = 2048;

/// คู่กุญแจพร้อมใช้: ฝั่งเซ็น (private) ฝั่ง verify (public) และ JWK สาธารณะ
/// สร้างครั้งเดียวตอน start server แล้ว share ผ่าน `AuthConfig` — ไม่มีการ rotate ใน v0.1
#[derive(Clone)]
pub struct JwtKeys {
    pub(crate) encoding: EncodingKey,
    pub(crate) decoding: DecodingKey,
    /// Key ID ตาม RFC 7638 (JWK thumbprint) — ใส่ใน JWT header ให้ relying party
    /// เลือก key ถูกตัวจาก JWKS ได้แม้อนาคตมีหลาย key ตอน rotate
    pub kid: String,
    /// JWK สาธารณะ (kty/n/e/alg/use/kid) — เสิร์ฟตรง ๆ ที่ `/.well-known/jwks.json`
    pub public_jwk: serde_json::Value,
}

impl JwtKeys {
    /// โหลดจาก private key PEM (PKCS#8) — ทางหลักสำหรับ production
    pub fn from_rsa_pem(private_pem: &str) -> Result<Self> {
        let private = RsaPrivateKey::from_pkcs8_pem(private_pem)
            .map_err(|e| Error::Config(format!("invalid RSA private key PEM: {e}")))?;
        Self::from_private(private, private_pem)
    }

    /// สร้างคู่กุญแจใหม่ — คืน PEM ด้วยเพื่อให้ผู้เรียก persist ได้ (dev bootstrap / test)
    pub fn generate() -> Result<(Self, String)> {
        let mut rng = rand_core::OsRng;
        let private = RsaPrivateKey::new(&mut rng, RSA_BITS)
            .map_err(|e| Error::Internal(format!("generate RSA key failed: {e}")))?;
        let pem = private
            .to_pkcs8_pem(LineEnding::LF)
            .map_err(|e| Error::Internal(format!("encode RSA key failed: {e}")))?
            .to_string();
        let keys = Self::from_private(private, &pem)?;
        Ok((keys, pem))
    }

    fn from_private(private: RsaPrivateKey, private_pem: &str) -> Result<Self> {
        let public: RsaPublicKey = private.to_public_key();
        let n = URL_SAFE_NO_PAD.encode(public.n().to_bytes_be());
        let e = URL_SAFE_NO_PAD.encode(public.e().to_bytes_be());

        // RFC 7638: thumbprint = SHA-256 ของ JSON ที่มีเฉพาะ required member เรียง lexicographic
        let thumbprint_input = format!(r#"{{"e":"{e}","kty":"RSA","n":"{n}"}}"#);
        let kid = URL_SAFE_NO_PAD.encode(Sha256::digest(thumbprint_input.as_bytes()));

        let encoding = EncodingKey::from_rsa_pem(private_pem.as_bytes())
            .map_err(|e| Error::Config(format!("load RSA signing key failed: {e}")))?;
        let decoding = DecodingKey::from_rsa_components(&n, &e)
            .map_err(|e| Error::Config(format!("load RSA verify key failed: {e}")))?;

        let public_jwk = serde_json::json!({
            "kty": "RSA",
            "use": "sig",
            "alg": "RS256",
            "kid": kid,
            "n": n,
            "e": e,
        });

        Ok(Self {
            encoding,
            decoding,
            kid,
            public_jwk,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_then_reload_from_pem_yields_same_kid() {
        let (keys, pem) = JwtKeys::generate().unwrap();
        let reloaded = JwtKeys::from_rsa_pem(&pem).unwrap();
        assert_eq!(keys.kid, reloaded.kid);
        assert_eq!(keys.public_jwk, reloaded.public_jwk);
        assert_eq!(keys.public_jwk["kty"], "RSA");
        assert_eq!(keys.public_jwk["alg"], "RS256");
    }
}
