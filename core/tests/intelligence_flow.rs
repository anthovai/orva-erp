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

/// M8 DoD: "มี insight เกิดจาก rule จริงอย่างน้อย 1 เคส" — เต็มวงจรผ่าน HTTP:
/// สร้าง rule → เหตุการณ์เกิดซ้ำจริงผ่าน API ปกติ → insight เกิด → notification ถูกส่ง
#[tokio::test]
async fn intelligence_rule_creates_insight_and_notification_via_http() {
    let state = support::test_state().await;
    let app = orva_core::app(state);

    let suffix = uuid::Uuid::new_v4();
    let slug = format!("intel-flow-{suffix}");
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/organizations")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "Intel Flow Co",
                        "slug": slug,
                        "owner_email": format!("owner-{suffix}@test.local"),
                        "owner_display_name": "Owner",
                        "owner_password": "correct-horse-battery",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let owner_token = json_body(response).await["access_token"]
        .as_str()
        .unwrap()
        .to_string();
    let owner_id = {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/auth/me")
                    .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        json_body(response).await["id"]
            .as_str()
            .unwrap()
            .to_string()
    };

    // สร้าง rule: แจ้งเตือนถ้ามีการสร้าง role ตั้งแต่ 2 ครั้งขึ้นไปในหน้าต่าง 1 ชั่วโมง
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/intelligence/rules")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::from(
                    json!({
                        "name": "too-many-roles",
                        "event_type": "role.created",
                        "metric": "count",
                        "window_seconds": 3600,
                        "operator": "gte",
                        "threshold": 2.0,
                        "notify_user_id": owner_id,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);

    // ยังไม่มี role ถูกสร้างเลย — insight ต้องยังว่าง
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/insights")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let insights = json_body(response).await;
    assert!(insights.as_array().unwrap().is_empty());

    // สร้าง role 2 ครั้งผ่าน API ปกติ (เหมือน user ทำงานจริง ไม่ได้ยิง event bus ตรง ๆ)
    for name in ["role-a", "role-b"] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/roles")
                    .header("content-type", "application/json")
                    .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                    .body(Body::from(json!({ "name": name }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
    }

    // ตอนนี้ต้องมี insight แล้ว (เกิดทันทีตอน event ที่ 2 เข้ามา ไม่ต้องรอ scheduler)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/insights")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let insights = json_body(response).await;
    let insights = insights.as_array().unwrap();
    assert_eq!(insights.len(), 1);
    assert_eq!(insights[0]["rule_name"], "too-many-roles");

    // owner (ผู้ที่ notify_user_id ระบุ) ต้องได้ notification จริง
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/notifications")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let notifications = json_body(response).await;
    assert!(notifications
        .as_array()
        .unwrap()
        .iter()
        .any(|n| n["title"] == "New insight"));
}
