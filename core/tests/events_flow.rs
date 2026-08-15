mod support;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

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

struct ProvisionedOrg {
    owner_token: String,
}

async fn provision(app: &axum::Router, prefix: &str) -> ProvisionedOrg {
    let suffix = uuid::Uuid::new_v4();
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
                        "slug": format!("{prefix}-{suffix}"),
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
    ProvisionedOrg { owner_token }
}

/// DoD M5 ที่ระดับ HTTP จริง: การ provision (module A) publish event ที่ subscriber
/// ภายนอก (module B — จำลองด้วย closure) รับได้ทันที และ event เดียวกันต้อง query
/// ย้อนหลังผ่าน `GET /api/v1/events` ได้ด้วย (ไม่ใช่แค่เห็นในโค้ดภายใน)
#[tokio::test]
async fn provisioning_publishes_and_is_queryable_via_api() {
    let state = support::test_state().await;

    let received = Arc::new(AtomicUsize::new(0));
    let received_clone = received.clone();
    state.event_bus.subscribe(
        orva_events::catalog::ORGANIZATION_PROVISIONED,
        Arc::new(move |_event| {
            let received = received_clone.clone();
            Box::pin(async move {
                received.fetch_add(1, Ordering::SeqCst);
                Ok(())
            })
        }),
    );

    let app = orva_core::app(state);
    let org = provision(&app, "events-org").await;

    // subscriber ต้องถูกเรียกแล้วก่อน publish() คืนค่า (dispatch แบบ synchronous)
    assert_eq!(received.load(Ordering::SeqCst), 1);

    // owner ได้ core.event.read มาด้วยตอน provisioning (grant ทุก permission ใน catalog ปัจจุบัน)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/events")
                .header(AUTHORIZATION, format!("Bearer {}", org.owner_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let events = json_body(response).await;
    let events = events.as_array().unwrap();
    assert!(events
        .iter()
        .any(|e| e["event_type"] == "organization.provisioned"));
}

/// event log ก็แยกตาม tenant เหมือนข้อมูลอื่น ๆ — org B มองไม่เห็น event ของ org A
#[tokio::test]
async fn events_are_isolated_per_tenant() {
    let state = support::test_state().await;
    let app = orva_core::app(state);

    let org_a = provision(&app, "events-a").await;
    let org_b = provision(&app, "events-b").await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/roles")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {}", org_a.owner_token))
                .body(Body::from(json!({ "name": "distinct-a-role" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/events?event_type=role.created")
                .header(AUTHORIZATION, format!("Bearer {}", org_b.owner_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let events = json_body(response).await;
    assert!(events.as_array().unwrap().is_empty());
}
