mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use tower::util::ServiceExt;

async fn json_body(response: axum::response::Response) -> Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

/// M4 DoD: request validation ต้องตอบรูปแบบ error เดียวกับทั้ง API (`{"error": "..."}`, 400)
/// ไม่ใช่ plain-text rejection ของ axum เอง
#[tokio::test]
async fn invalid_request_returns_standard_error_shape() {
    let state = support::test_state().await;
    let app = orva_core::app(state);

    // email ผิดรูปแบบ
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/organizations")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "Org",
                        "slug": "gateway-org",
                        "owner_email": "not-an-email",
                        "owner_display_name": "Owner",
                        "owner_password": "correct-horse-battery",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = json_body(response).await;
    assert!(body["error"].is_string());

    // password สั้นเกินนโยบาย
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/organizations")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "Org",
                        "slug": "gateway-org-2",
                        "owner_email": "owner@gateway.local",
                        "owner_display_name": "Owner",
                        "owner_password": "short",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    // JSON เพี้ยนทั้งชิ้น (malformed) ก็ต้องได้ error shape เดียวกัน ไม่ใช่ panic/500
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/organizations")
                .header("content-type", "application/json")
                .body(Body::from("{ not json"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = json_body(response).await;
    assert!(body["error"].is_string());
}

/// M4 DoD: rate limiting ต่อ key (bearer token/IP) — ใช้ quota ต่ำมากเฉพาะ test นี้
/// เพื่อพิสูจน์ 429 โดยไม่ต้องยิงร้อยครั้งจริง
#[tokio::test]
async fn rate_limit_returns_429_after_quota_exhausted() {
    let pool = orva_data::connect(&support::test_database_url())
        .await
        .expect("connect");
    orva_data::migrate(&pool).await.expect("migrate");
    let state =
        orva_core::AppState::with_rate_limit(pool, "test-secret", "orva-core-test", 2).await;
    let app = orva_core::app(state);

    let make_request = || {
        Request::builder()
            .uri("/health")
            .header("Authorization", "Bearer rate-limit-test-token")
            .body(Body::empty())
            .unwrap()
    };

    let first = app.clone().oneshot(make_request()).await.unwrap();
    assert_eq!(first.status(), StatusCode::OK);
    let second = app.clone().oneshot(make_request()).await.unwrap();
    assert_eq!(second.status(), StatusCode::OK);

    let third = app.oneshot(make_request()).await.unwrap();
    assert_eq!(third.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn responses_include_security_headers_and_cors() {
    let state = support::test_state().await;
    let app = orva_core::app(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .header("Origin", "https://example.com")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let headers = response.headers();
    assert_eq!(headers.get("x-content-type-options").unwrap(), "nosniff");
    assert_eq!(headers.get("x-frame-options").unwrap(), "DENY");
    assert!(headers.contains_key("access-control-allow-origin"));
}

/// M4 DoD: OpenAPI docs อัตโนมัติ — spec ต้องมีครบทุก route ที่สำคัญ
#[tokio::test]
async fn openapi_spec_lists_all_routes() {
    let state = support::test_state().await;
    let app = orva_core::app(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api-docs/openapi.json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let spec = json_body(response).await;
    let paths = spec["paths"].as_object().unwrap();
    for expected in [
        "/health",
        "/api/v1/organizations",
        "/api/v1/auth/login",
        "/api/v1/auth/register",
        "/api/v1/roles",
        "/api/v1/roles/{role_id}/permissions",
        "/api/v1/roles/{role_id}/assign",
        "/api/v1/service-identities",
    ] {
        assert!(paths.contains_key(expected), "missing path: {expected}");
    }
}
