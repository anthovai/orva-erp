//! TOTP (RFC 6238) สำหรับ MFA — ห่อ `totp-rs` ให้เป็น API แคบ ๆ ที่ AuthService ใช้
//!
//! ค่ามาตรฐานตาม authenticator app ทั่วไป: SHA-1, 6 หลัก, ช่วงละ 30 วินาที
//! (skew 1 ช่วง = ยอมรับ code ของช่วงก่อน/ถัดไปด้วย กัน clock เหลื่อมเล็กน้อย)

use orva_error::{Error, Result};
use totp_rs::{Algorithm, Secret, TOTP};

const DIGITS: usize = 6;
const SKEW: u8 = 1;
const STEP_SECONDS: u64 = 30;

/// สร้าง secret ใหม่ (base32) + otpauth:// URI สำหรับให้ user สแกนเข้า authenticator app
pub fn generate(issuer: &str, account_email: &str) -> Result<(String, String)> {
    let secret = Secret::generate_secret();
    let totp = build(&secret.to_encoded().to_string(), issuer, account_email)?;
    Ok((secret.to_encoded().to_string(), totp.get_url()))
}

/// ตรวจ code กับ secret (base32) — คืน `true` เมื่อ code ถูกต้องในช่วงเวลาปัจจุบัน ± skew
pub fn verify(secret_base32: &str, code: &str) -> Result<bool> {
    let totp = build(secret_base32, "orva", "verify")?;
    totp.check_current(code)
        .map_err(|e| Error::Internal(format!("totp time error: {e}")))
}

fn build(secret_base32: &str, issuer: &str, account: &str) -> Result<TOTP> {
    let secret = Secret::Encoded(secret_base32.to_string())
        .to_bytes()
        .map_err(|e| Error::Internal(format!("invalid totp secret: {e:?}")))?;
    TOTP::new(
        Algorithm::SHA1,
        DIGITS,
        SKEW,
        STEP_SECONDS,
        secret,
        Some(issuer.to_string()),
        account.to_string(),
    )
    .map_err(|e| Error::Internal(format!("build totp failed: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_secret_round_trips() {
        let (secret, uri) = generate("orva-core", "user@test.local").unwrap();
        assert!(uri.starts_with("otpauth://totp/"));
        assert!(uri.contains("orva-core"));

        // code ที่คำนวณจาก secret เดียวกัน ณ เวลานี้ ต้อง verify ผ่าน
        let totp = build(&secret, "orva-core", "user@test.local").unwrap();
        let code = totp.generate_current().unwrap();
        assert!(verify(&secret, &code).unwrap());

        // code มั่ว ๆ ต้องไม่ผ่าน
        assert!(!verify(&secret, "000000").unwrap() || code == "000000");
    }
}
