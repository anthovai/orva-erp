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
        orva_core::AppState::with_rate_limit(pool, support::test_keys(), "orva-core-test", 2).await;
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

/// ADR 0012: rate limit ระดับ**องค์กร** — ตั้ง quota ต่ำผ่าน API แล้วทั้งองค์กรโดนจำกัดรวมกัน
/// (คนละชั้นกับ per-token limiter ของ M4) และองค์กรอื่นไม่โดนหางเลข
#[tokio::test]
async fn per_tenant_rate_limit_throttles_whole_organization() {
    let state = support::test_state().await;
    let app = orva_core::app(state);

    let provision = |slug: String| {
        Request::builder()
            .method("POST")
            .uri("/api/v1/organizations")
            .header("content-type", "application/json")
            .body(Body::from(
                json!({
                    "name": "Tenant RL",
                    "slug": slug,
                    "owner_email": format!("owner@{slug}.test"),
                    "owner_display_name": "Owner",
                    "owner_password": "correct-horse-battery",
                })
                .to_string(),
            ))
            .unwrap()
    };

    let slug_a = format!("tenant-rl-a-{}", uuid::Uuid::new_v4());
    let response = app.clone().oneshot(provision(slug_a)).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let token_a = json_body(response).await["access_token"]
        .as_str()
        .unwrap()
        .to_string();

    let slug_b = format!("tenant-rl-b-{}", uuid::Uuid::new_v4());
    let response = app.clone().oneshot(provision(slug_b)).await.unwrap();
    let token_b = json_body(response).await["access_token"]
        .as_str()
        .unwrap()
        .to_string();

    // ตั้ง quota ขององค์กร A = 2 req/min (มีผลทันที — cache ถูก invalidate)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/organizations/current/rate-limit")
                .header("content-type", "application/json")
                .header("Authorization", format!("Bearer {token_a}"))
                .body(Body::from(json!({ "requests_per_minute": 2 }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let me = |token: &str| {
        Request::builder()
            .uri("/api/v1/auth/me")
            .header("Authorization", format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap()
    };

    // องค์กร A: 2 request แรกผ่าน request ที่ 3 โดน 429
    let first = app.clone().oneshot(me(&token_a)).await.unwrap();
    assert_eq!(first.status(), StatusCode::OK);
    let second = app.clone().oneshot(me(&token_a)).await.unwrap();
    assert_eq!(second.status(), StatusCode::OK);
    let third = app.clone().oneshot(me(&token_a)).await.unwrap();
    assert_eq!(third.status(), StatusCode::TOO_MANY_REQUESTS);
    let body = json_body(third).await;
    assert!(body["error"].as_str().unwrap().contains("rate limit"));

    // องค์กร B ไม่กระทบ — quota แยกกันต่อ tenant
    let response = app.oneshot(me(&token_b)).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

/// endpoint แก้ rate limit ต้องรอดจาก throttle เสมอ — องค์กรที่ตั้ง quota ต่ำเกิน
/// ต้องแก้ตัวเองกลับได้ ไม่ใช่ล็อกตัวเองตาย (ADR 0012)
#[tokio::test]
async fn rate_limit_endpoint_is_exempt_so_org_can_unlock_itself() {
    let state = support::test_state().await;
    let app = orva_core::app(state);

    let slug = format!("tenant-rl-unlock-{}", uuid::Uuid::new_v4());
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/organizations")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "Unlock Co",
                        "slug": slug,
                        "owner_email": format!("owner@{slug}.test"),
                        "owner_display_name": "Owner",
                        "owner_password": "correct-horse-battery",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let token = json_body(response).await["access_token"]
        .as_str()
        .unwrap()
        .to_string();

    let set_limit = |value: serde_json::Value, token: &str| {
        Request::builder()
            .method("POST")
            .uri("/api/v1/organizations/current/rate-limit")
            .header("content-type", "application/json")
            .header("Authorization", format!("Bearer {token}"))
            .body(Body::from(
                json!({ "requests_per_minute": value }).to_string(),
            ))
            .unwrap()
    };

    // ตั้ง quota = 1 แล้วเผา quota จนโดน 429
    let response = app
        .clone()
        .oneshot(set_limit(json!(1), &token))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let _ = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/me")
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let throttled = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/me")
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(throttled.status(), StatusCode::TOO_MANY_REQUESTS);

    // แม้โดน throttle อยู่ endpoint แก้ quota ต้องยังใช้ได้ → ปลดล็อกตัวเองกลับ
    let response = app
        .clone()
        .oneshot(set_limit(json!(null), &token))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/me")
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}
