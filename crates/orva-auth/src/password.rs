use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use orva_error::{Error, Result};
use rand_core::OsRng;

/// นโยบายรหัสผ่านของ M2: ยาวอย่างน้อย 8 ตัวอักษร — เข้มขึ้นได้ภายหลังเมื่อมี password policy engine
pub fn validate_policy(plain: &str) -> Result<()> {
    if plain.len() < 8 {
        return Err(Error::Validation(
            "password must be at least 8 characters".to_string(),
        ));
    }
    Ok(())
}

pub fn hash_password(plain: &str) -> Result<String> {
    validate_policy(plain)?;
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(plain.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| Error::Internal(format!("password hash failed: {e}")))
}

pub fn verify_password(plain: &str, hash: &str) -> Result<bool> {
    let parsed = PasswordHash::new(hash)
        .map_err(|e| Error::Internal(format!("invalid password hash: {e}")))?;
    Ok(Argon2::default()
        .verify_password(plain.as_bytes(), &parsed)
        .is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_then_verify_roundtrip() {
        let hash = hash_password("correct-horse-battery").unwrap();
        assert!(verify_password("correct-horse-battery", &hash).unwrap());
        assert!(!verify_password("wrong-password", &hash).unwrap());
    }

    #[test]
    fn rejects_short_password() {
        assert!(hash_password("short").is_err());
    }
}
