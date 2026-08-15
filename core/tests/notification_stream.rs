//! ADR 0013: real-time push — subscribe SSE ก่อน แล้ว trigger เหตุการณ์ที่สร้าง
//! notification จริง ต้องเห็น event ไหลออกมาใน stream โดยไม่ต้อง poll

mod support;

use axum::body::Body;
use axum::http::{header::AUTHORIZATION, Request, StatusCode};
use futures_util::StreamExt;
use serde_json::{json, Value};
use tower::util::ServiceExt;

async fn json_body(response: axum::response::Response) -> Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn sse_stream_delivers_new_notification_in_real_time() {
    let state = support::test_state().await;
    let app = orva_core::app(state);

    // provision org + owner
    let suffix = uuid::Uuid::new_v4();
    let slug = format!("sse-flow-{suffix}");
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/organizations")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "SSE Co",
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
    let token = json_body(response).await["access_token"]
        .as_str()
        .unwrap()
        .to_string();
    let owner_id = {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/auth/me")
                    .header(AUTHORIZATION, format!("Bearer {token}"))
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

    // stream ต้อง auth — ไม่มี token = 401
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/notifications/stream")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    // 1) subscribe SSE ก่อน (body ค้างเป็น stream — ตัว receiver ถูกถือไว้ในนี้)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/notifications/stream")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap()
        .starts_with("text/event-stream"));
    let mut sse_body = response.into_body().into_data_stream();

    // 2) trigger: workflow ที่ rule บังคับขออนุมัติ → notification "Approval requested"
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/workflows")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::from(
                    json!({
                        "resource_type": "sse_test",
                        "resource_id": uuid::Uuid::new_v4(),
                        "context": {"amount": 900},
                        "rule": {"field": "amount", "operator": "gt", "value": 100},
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let workflow_id = json_body(response).await["id"]
        .as_str()
        .unwrap()
        .to_string();
    for step in ["start-review", "advance"] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/workflows/{workflow_id}/{step}"))
                    .header("content-type", "application/json")
                    .header(AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::from(json!({ "approver_id": owner_id }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "step {step}");
    }

    // 3) event ต้องไหลออกมาใน stream (ไม่ poll DB เลย) — รอไม่เกิน 5 วินาที
    let mut received = String::new();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        let chunk = tokio::time::timeout(remaining, sse_body.next())
            .await
            .expect("SSE event must arrive within 5s")
            .expect("stream must stay open")
            .expect("stream chunk");
        received.push_str(std::str::from_utf8(&chunk).unwrap());
        if received.contains("event: notification") && received.contains("Approval requested") {
            break;
        }
    }
    assert!(received.contains("\"channel\":\"in_app\""));
}
