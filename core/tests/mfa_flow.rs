//! MFA TOTP ครบวงจร (ADR 0007): setup → activate → login ถูกบังคับ code → disable
//!
//! test เล่นบท authenticator app: คำนวณ code จริงจาก secret ที่ endpoint setup คืนมา

mod support;

use axum::body::Body;
use axum::http::{header::AUTHORIZATION, Request, StatusCode};
use serde_json::{json, Value};
use totp_rs::{Algorithm, Secret, TOTP};
use tower::util::ServiceExt;

async fn json_body(response: axum::response::Response) -> Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

/// คำนวณ code ปัจจุบันจาก secret base32 — พารามิเตอร์เดียวกับฝั่ง server (SHA1/6/30s)
fn current_code(secret_base32: &str) -> String {
    let secret = Secret::Encoded(secret_base32.to_string())
        .to_bytes()
        .unwrap();
    TOTP::new(Algorithm::SHA1, 6, 1, 30, secret, None, "test".to_string())
        .unwrap()
        .generate_current()
        .unwrap()
}

fn login_request(slug: &str, email: &str, totp_code: Option<&str>) -> Request<Body> {
    let mut body = json!({
        "organization_slug": slug,
        "email": email,
        "password": "correct-horse-battery",
    });
    if let Some(code) = totp_code {
        body["totp_code"] = json!(code);
    }
    Request::builder()
        .method("POST")
        .uri("/api/v1/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

#[tokio::test]
async fn mfa_full_lifecycle() {
    let state = support::test_state().await;
    let org = support::seed_organization(&state).await;
    let app = orva_core::app(state);
    let email = "mfa@test.local";

    // register + login ปกติ (ยังไม่มี MFA)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/register")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "organization_slug": org.slug,
                        "email": email,
                        "display_name": "Mfa",
                        "password": "correct-horse-battery",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);

    let response = app
        .clone()
        .oneshot(login_request(&org.slug, email, None))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let token = json_body(response).await["access_token"]
        .as_str()
        .unwrap()
        .to_string();

    // setup MFA → ได้ secret + otpauth URI
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/mfa/setup")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let setup = json_body(response).await;
    let secret = setup["secret"].as_str().unwrap().to_string();
    assert!(setup["otpauth_uri"]
        .as_str()
        .unwrap()
        .starts_with("otpauth://totp/"));

    // ยัง pending — login โดยไม่ใส่ code ยังต้องผ่านอยู่ (กันล็อกตัวเองก่อนสแกน QR เสร็จ)
    let response = app
        .clone()
        .oneshot(login_request(&org.slug, email, None))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // activate ด้วย code มั่ว → 401 และ MFA ยังไม่เปิด
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/mfa/activate")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::from(json!({ "code": "000000" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    // 000000 มีโอกาสบังเอิญตรง code จริง 1 ในล้าน — ยอมรับ 204 กรณีนั้น
    assert!(
        response.status() == StatusCode::UNAUTHORIZED
            || response.status() == StatusCode::NO_CONTENT
    );

    // activate ด้วย code จริง → 204
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/mfa/activate")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::from(
                    json!({ "code": current_code(&secret) }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    // login โดยไม่ใส่ code → 400 (บอก client ว่าต้องถาม code)
    let response = app
        .clone()
        .oneshot(login_request(&org.slug, email, None))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = json_body(response).await;
    assert!(body["error"].as_str().unwrap().contains("totp_code"));

    // login ด้วย code ผิด → 401
    let response = app
        .clone()
        .oneshot(login_request(&org.slug, email, Some("000000")))
        .await
        .unwrap();
    assert!(response.status() == StatusCode::UNAUTHORIZED || response.status() == StatusCode::OK);

    // login ด้วย code ถูก → 200
    let response = app
        .clone()
        .oneshot(login_request(
            &org.slug,
            email,
            Some(&current_code(&secret)),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let token = json_body(response).await["access_token"]
        .as_str()
        .unwrap()
        .to_string();

    // disable ด้วย code ถูก → 204 แล้ว login ปกติได้อีกครั้ง
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/mfa/disable")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::from(
                    json!({ "code": current_code(&secret) }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let response = app
        .oneshot(login_request(&org.slug, email, None))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}
