mod support;

use axum::body::Body;
use axum::http::{header::AUTHORIZATION, Request, StatusCode};
use serde_json::{json, Value};
use tower::util::ServiceExt;

async fn json_body(response: axum::response::Response) -> Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn register_login_call_protected_api_and_logout() {
    let state = support::test_state().await;
    let org = support::seed_organization(&state).await;
    let app = orva_core::app(state);

    // 1. register
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
                        "email": "owner@test.local",
                        "display_name": "Owner",
                        "password": "correct-horse-battery",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);

    // 2. login → session token + id_token
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "organization_slug": org.slug,
                        "email": "owner@test.local",
                        "password": "correct-horse-battery",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let tokens = json_body(response).await;
    let access_token = tokens["access_token"].as_str().unwrap().to_string();
    assert!(!tokens["id_token"].as_str().unwrap().is_empty());
    assert_eq!(tokens["token_type"], "Bearer");

    // wrong password must fail
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "organization_slug": org.slug,
                        "email": "owner@test.local",
                        "password": "wrong-password",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    // 3. call ปกป้อง API ด้วย token — พิสูจน์ DoD "เรียก API ที่ต้อง auth ได้"
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/me")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let me = json_body(response).await;
    assert_eq!(me["email"], "owner@test.local");

    // ไม่มี token ต้องโดนปฏิเสธ
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/me")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    // 4. logout → session ใช้ต่อไม่ได้
    // (service identity / role permission enforcement ทดสอบแยกใน authz_flow.rs
    // เพราะ user ที่สมัครผ่าน /register เฉย ๆ ไม่มี role/permission ใด ๆ)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/logout")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/me")
                .header(AUTHORIZATION, format!("Bearer {access_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn openid_configuration_is_exposed() {
    let state = support::test_state().await;
    let app = orva_core::app(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/.well-known/openid-configuration")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let doc = json_body(response).await;
    assert_eq!(doc["issuer"], "orva-core-test");
    assert!(doc["userinfo_endpoint"].is_string());
    assert_eq!(doc["jwks_uri"], "/.well-known/jwks.json");
    assert_eq!(doc["id_token_signing_alg_values_supported"][0], "RS256");
}

/// ADR 0006: relying party ภายนอกต้อง verify ID token ได้จาก JWKS สาธารณะล้วน ๆ
/// — test นี้เล่นบท relying party: ดึง JWKS ผ่าน HTTP แล้ว verify ลายเซ็นเอง
/// โดยไม่แตะ state ภายในของ server เลย
#[tokio::test]
async fn id_token_verifies_against_published_jwks() {
    let state = support::test_state().await;
    let org = support::seed_organization(&state).await;
    let app = orva_core::app(state);

    // สมัคร + login เพื่อให้ได้ id_token จริงจาก server
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
                        "email": "jwks@test.local",
                        "display_name": "Jwks",
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
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "organization_slug": org.slug,
                        "email": "jwks@test.local",
                        "password": "correct-horse-battery",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let tokens = json_body(response).await;
    let id_token = tokens["id_token"].as_str().unwrap().to_string();

    // ดึง JWKS แบบ relying party
    let response = app
        .oneshot(
            Request::builder()
                .uri("/.well-known/jwks.json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let jwks = json_body(response).await;
    let jwk = &jwks["keys"][0];
    assert_eq!(jwk["kty"], "RSA");
    assert_eq!(jwk["alg"], "RS256");

    // header ของ token ต้องชี้ kid เดียวกับใน JWKS
    let header = jsonwebtoken::decode_header(&id_token).unwrap();
    assert_eq!(header.alg, jsonwebtoken::Algorithm::RS256);
    assert_eq!(header.kid.as_deref(), jwk["kid"].as_str());

    // verify ลายเซ็นจาก n/e ใน JWKS ล้วน ๆ (ไม่มี secret แชร์)
    let key = jsonwebtoken::DecodingKey::from_rsa_components(
        jwk["n"].as_str().unwrap(),
        jwk["e"].as_str().unwrap(),
    )
    .unwrap();
    let mut validation = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::RS256);
    validation.set_audience(&["orva-core"]);
    let claims = jsonwebtoken::decode::<serde_json::Value>(&id_token, &key, &validation)
        .unwrap()
        .claims;
    assert_eq!(claims["iss"], "orva-core-test");
    assert_eq!(claims["email"], "jwks@test.local");
}
