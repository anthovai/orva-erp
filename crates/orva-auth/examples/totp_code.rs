//! Dev tool: พิมพ์ TOTP code ปัจจุบันจาก secret (base32) — ใช้ทดสอบ MFA ด้วยมือ
//!
//! ```bash
//! cargo run -p orva-auth --example totp_code -- <BASE32_SECRET>
//! ```

fn main() {
    let secret = std::env::args()
        .nth(1)
        .expect("usage: totp_code <BASE32_SECRET>");
    let bytes = totp_rs::Secret::Encoded(secret)
        .to_bytes()
        .expect("valid base32");
    let totp = totp_rs::TOTP::new(
        totp_rs::Algorithm::SHA1,
        6,
        1,
        30,
        bytes,
        None,
        "manual".to_string(),
    )
    .expect("build totp");
    println!("{}", totp.generate_current().expect("system clock"));
}
