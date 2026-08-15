use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use sha2::{Digest, Sha256};

/// สร้าง opaque token แบบสุ่ม (256-bit) — ใช้เป็นทั้ง session token และ service identity key
///
/// เก็บเฉพาะ [`hash`] ของ token ลงฐานข้อมูล ไม่เก็บ raw token — ป้องกันข้อมูลรั่วจาก DB dump
pub fn generate() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn hash(raw_token: &str) -> String {
    let digest = Sha256::digest(raw_token.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_is_unique_and_hash_is_deterministic() {
        let a = generate();
        let b = generate();
        assert_ne!(a, b);
        assert_eq!(hash(&a), hash(&a));
        assert_ne!(hash(&a), hash(&b));
    }
}
