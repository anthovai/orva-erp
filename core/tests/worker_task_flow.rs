//! ADR 0019: ORVA Worker task queue เต็มวงจรผ่าน HTTP —
//! มนุษย์มอบงาน → worker poll คิว → claim (atomic, worker ตัวที่สองได้ 409) →
//! รายงานผล → คนสั่งงานได้ notification; ยกเลิกงานที่ถูก claim แล้วไม่ได้

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

struct Ctx {
    token: String,
    /// key ที่มี scope ครบ (อ่านคิว + claim/รายงานผล)
    worker_key: String,
    /// key ที่อ่านคิวได้อย่างเดียว — พิสูจน์ fail-closed ของ ADR 0011
    readonly_key: String,
}

async fn issue_key(app: &axum::Router, token: &str, name: &str, scopes: Value) -> String {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/service-identities")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::from(
                    json!({ "name": name, "scopes": scopes }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    json_body(response).await["api_key"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn setup(app: &axum::Router) -> Ctx {
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
                        "name": "Worker Co",
                        "slug": format!("worker-{suffix}"),
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
    let token = json_body(response).await["access_token"]
        .as_str()
        .unwrap()
        .to_string();

    let worker_key = issue_key(
        app,
        &token,
        "orva-worker",
        json!(["agent:task:read", "agent:task:write"]),
    )
    .await;
    let readonly_key = issue_key(app, &token, "queue-watcher", json!(["agent:task:read"])).await;

    Ctx {
        token,
        worker_key,
        readonly_key,
    }
}

fn agent_get(uri: &str, key: &str) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .header("X-Orva-Service-Key", key)
        .body(Body::empty())
        .unwrap()
}

fn agent_post(uri: &str, key: &str, body: Option<Value>) -> Request<Body> {
    let builder = Request::builder()
        .method("POST")
        .uri(uri)
        .header("X-Orva-Service-Key", key)
        .header("content-type", "application/json");
    match body {
        Some(b) => builder.body(Body::from(b.to_string())).unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    }
}

#[tokio::test]
async fn worker_task_full_loop_dispatch_claim_and_report() {
    let state = support::test_state().await;
    let app = orva_core::app(state);
    let ctx = setup(&app).await;

    // มนุษย์มอบงาน
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/worker/tasks")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {}", ctx.token))
                .body(Body::from(
                    json!({ "instruction": "สรุปยอดขายสัปดาห์นี้ส่งเข้าอีเมล" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let task = json_body(response).await;
    assert_eq!(task["status"], "pending");
    assert_eq!(task["source"], "manual");
    let task_id = task["id"].as_str().unwrap().to_string();

    // worker poll เห็นงานในคิว
    let response = app
        .clone()
        .oneshot(agent_get("/api/v1/agent/tasks", &ctx.worker_key))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let queue = json_body(response).await;
    assert!(queue
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["id"] == task_id.as_str()));

    // claim สำเร็จ
    let response = app
        .clone()
        .oneshot(agent_post(
            &format!("/api/v1/agent/tasks/{task_id}/claim"),
            &ctx.worker_key,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_body(response).await["status"], "running");

    // worker ตัวที่สอง claim ซ้ำ → 409 (atomic claim)
    let response = app
        .clone()
        .oneshot(agent_post(
            &format!("/api/v1/agent/tasks/{task_id}/claim"),
            &ctx.worker_key,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);

    // งานที่ถูก claim แล้วยกเลิกไม่ได้
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/worker/tasks/{task_id}/cancel"))
                .header(AUTHORIZATION, format!("Bearer {}", ctx.token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    // รายงานผลสำเร็จ
    let response = app
        .clone()
        .oneshot(agent_post(
            &format!("/api/v1/agent/tasks/{task_id}/result"),
            &ctx.worker_key,
            Some(json!({ "succeeded": true, "result": "ส่งอีเมลแล้ว 3 ฉบับ" })),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let done = json_body(response).await;
    assert_eq!(done["status"], "succeeded");
    assert_eq!(done["result"], "ส่งอีเมลแล้ว 3 ฉบับ");

    // รายงานซ้ำไม่ได้ (ไม่ได้ running แล้ว)
    let response = app
        .clone()
        .oneshot(agent_post(
            &format!("/api/v1/agent/tasks/{task_id}/result"),
            &ctx.worker_key,
            Some(json!({ "succeeded": true })),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    // คนสั่งงานได้ notification ผลลัพธ์
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/notifications")
                .header(AUTHORIZATION, format!("Bearer {}", ctx.token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let notifications = json_body(response).await;
    assert!(
        notifications
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["title"] == "Worker task succeeded"),
        "expected a completion notification: {notifications}"
    );

    // คิวว่างแล้ว
    let response = app
        .clone()
        .oneshot(agent_get("/api/v1/agent/tasks", &ctx.worker_key))
        .await
        .unwrap();
    assert!(json_body(response).await.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn claiming_requires_write_scope() {
    let state = support::test_state().await;
    let app = orva_core::app(state);
    let ctx = setup(&app).await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/worker/tasks")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {}", ctx.token))
                .body(Body::from(
                    json!({ "instruction": "do a thing" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let task_id = json_body(response).await["id"]
        .as_str()
        .unwrap()
        .to_string();

    // อ่านคิวได้ (มี agent:task:read)
    let response = app
        .clone()
        .oneshot(agent_get("/api/v1/agent/tasks", &ctx.readonly_key))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // แต่ claim ไม่ได้ (ไม่มี agent:task:write) — fail-closed ตาม ADR 0011
    let response = app
        .clone()
        .oneshot(agent_post(
            &format!("/api/v1/agent/tasks/{task_id}/claim"),
            &ctx.readonly_key,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    // งานยัง pending อยู่ จึงยกเลิกได้
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/worker/tasks/{task_id}/cancel"))
                .header(AUTHORIZATION, format!("Bearer {}", ctx.token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_body(response).await["status"], "cancelled");
}
