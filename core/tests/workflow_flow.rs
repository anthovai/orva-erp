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
    owner_token: String,
    manager_token: String,
    manager_id: String,
}

async fn setup(app: &axum::Router, prefix: &str) -> Ctx {
    let suffix = uuid::Uuid::new_v4();
    let slug = format!("{prefix}-{suffix}");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/organizations")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "Workflow Co",
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

    // manager = สมาชิกธรรมดา ไม่มี role ใด ๆ (การ approve ไม่ต้องมี permission พิเศษ)
    let manager_email = format!("manager-{suffix}@test.local");
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/register")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "organization_slug": slug,
                        "email": manager_email,
                        "display_name": "Manager",
                        "password": "correct-horse-battery",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let manager_id = json_body(response).await["id"]
        .as_str()
        .unwrap()
        .to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "organization_slug": slug,
                        "email": manager_email,
                        "password": "correct-horse-battery",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let manager_token = json_body(response).await["access_token"]
        .as_str()
        .unwrap()
        .to_string();

    Ctx {
        owner_token,
        manager_token,
        manager_id,
    }
}

/// M6 DoD เต็มรูปแบบผ่าน HTTP จริง: "สร้าง workflow ที่มีเงื่อนไข approval ได้จริง,
/// ทุก action มี audit, มี notification แจ้งผู้อนุมัติ" — ตรงตัวอย่าง ARCHITECTURE.md §7
#[tokio::test]
async fn invoice_workflow_with_conditional_approval_end_to_end() {
    let state = support::test_state().await;
    let app = orva_core::app(state);
    let ctx = setup(&app, "wf-e2e").await;

    // 1. owner สร้าง workflow ผูกกับ "invoice" ที่มี amount เกิน threshold
    let resource_id = uuid::Uuid::new_v4();
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/workflows")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {}", ctx.owner_token))
                .body(Body::from(
                    json!({
                        "resource_type": "invoice",
                        "resource_id": resource_id,
                        "context": { "amount": 150000 },
                        "rule": { "field": "amount", "operator": "gt", "value": 100000 },
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let workflow = json_body(response).await;
    let workflow_id = workflow["id"].as_str().unwrap().to_string();
    assert_eq!(workflow["status"], "created");

    // 2. start review
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/workflows/{workflow_id}/start-review"))
                .header(AUTHORIZATION, format!("Bearer {}", ctx.owner_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // 3. advance — rule trigger, มอบให้ manager อนุมัติ
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/workflows/{workflow_id}/advance"))
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {}", ctx.owner_token))
                .body(Body::from(
                    json!({ "approver_id": ctx.manager_id }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_body(response).await["status"], "pending_approval");

    // 4. manager เห็นงานรออนุมัติของตัวเอง
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/approval-tasks/mine")
                .header(AUTHORIZATION, format!("Bearer {}", ctx.manager_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let tasks = json_body(response).await;
    let tasks = tasks.as_array().unwrap();
    assert_eq!(tasks.len(), 1);
    let task_id = tasks[0]["id"].as_str().unwrap().to_string();

    // 5. DoD: "มี notification แจ้งผู้อนุมัติ" — manager ต้องเห็น notification จริง
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/notifications?unread_only=true")
                .header(AUTHORIZATION, format!("Bearer {}", ctx.manager_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let notifications = json_body(response).await;
    let notifications = notifications.as_array().unwrap();
    assert!(!notifications.is_empty());
    assert!(notifications
        .iter()
        .any(|n| n["title"] == "Approval requested"));

    // คนอื่นที่ไม่ใช่ manager อนุมัติไม่ได้ (owner เองก็ไม่ได้ ถ้าไม่ใช่คนที่ถูก assign)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/approval-tasks/{task_id}/approve"))
                .header(AUTHORIZATION, format!("Bearer {}", ctx.owner_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    // 6. manager อนุมัติจริง
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/approval-tasks/{task_id}/approve"))
                .header(AUTHORIZATION, format!("Bearer {}", ctx.manager_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_body(response).await["status"], "executing");

    // 7. complete
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/workflows/{workflow_id}/complete"))
                .header(AUTHORIZATION, format!("Bearer {}", ctx.owner_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_body(response).await["status"], "completed");

    // 8. DoD: "ทุก action มี audit" — event log ต้องเห็นครบทุก transition ผูกกับ resource เดียวกัน
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/api/v1/events?resource_type=invoice&resource_id={resource_id}"
                ))
                .header(AUTHORIZATION, format!("Bearer {}", ctx.owner_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let events = json_body(response).await;
    let event_types: Vec<String> = events
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["event_type"].as_str().unwrap().to_string())
        .collect();

    for expected in [
        "workflow.created",
        "workflow.approval_requested",
        "workflow.approved",
        "workflow.completed",
    ] {
        assert!(
            event_types.contains(&expected.to_string()),
            "missing audit event: {expected} — got {event_types:?}"
        );
    }
}

/// DoD M6: state machine validation ที่ระดับ HTTP — เรียก transition ผิดลำดับต้องได้ 400
#[tokio::test]
async fn invalid_workflow_transition_returns_400() {
    let state = support::test_state().await;
    let app = orva_core::app(state);
    let ctx = setup(&app, "wf-invalid").await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/workflows")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {}", ctx.owner_token))
                .body(Body::from(
                    json!({
                        "resource_type": "document",
                        "resource_id": uuid::Uuid::new_v4(),
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let workflow_id = json_body(response).await["id"]
        .as_str()
        .unwrap()
        .to_string();

    // ยังอยู่ Created — complete() ตรง ๆ ต้องถูกปฏิเสธ
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/workflows/{workflow_id}/complete"))
                .header(AUTHORIZATION, format!("Bearer {}", ctx.owner_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// ADR 0009: definition ตั้งครั้งเดียว → instance อ้าง definition_id → rule/approver
/// default ถูกใช้อัตโนมัติ (advance โดยไม่ระบุ approver_id ก็เข้า PendingApproval ได้)
#[tokio::test]
async fn definition_based_workflow_uses_stored_rule_and_default_approver() {
    let state = support::test_state().await;
    let app = orva_core::app(state);
    let ctx = setup(&app, "wf-def").await;

    // สร้าง definition: purchase เกิน 1000 ต้องให้ manager อนุมัติ
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/workflow-definitions")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {}", ctx.owner_token))
                .body(Body::from(
                    json!({
                        "name": "purchase-approval",
                        "resource_type": "purchase",
                        "rule": {"field": "amount", "operator": "gt", "value": 1000},
                        "default_approver_id": ctx.manager_id,
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let definition = json_body(response).await;
    let definition_id = definition["id"].as_str().unwrap().to_string();
    assert_eq!(definition["resource_type"], "purchase");

    // list เห็น definition ที่ตั้งไว้
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/workflow-definitions")
                .header(AUTHORIZATION, format!("Bearer {}", ctx.owner_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_body(response).await.as_array().unwrap().len(), 1);

    // สร้าง instance จาก definition — ห้ามส่ง rule inline พร้อมกัน
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/workflows")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {}", ctx.owner_token))
                .body(Body::from(
                    json!({
                        "definition_id": definition_id,
                        "resource_id": uuid::Uuid::new_v4(),
                        "context": {"amount": 5000},
                        "rule": {"field": "amount", "operator": "gt", "value": 1},
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    // แบบถูกต้อง: definition_id อย่างเดียว — resource_type มาจาก definition
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/workflows")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {}", ctx.owner_token))
                .body(Body::from(
                    json!({
                        "definition_id": definition_id,
                        "resource_id": uuid::Uuid::new_v4(),
                        "context": {"amount": 5000},
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let instance = json_body(response).await;
    let instance_id = instance["id"].as_str().unwrap().to_string();
    assert_eq!(instance["resource_type"], "purchase");

    // start review → advance โดย**ไม่ระบุ approver_id** — ต้อง fallback ไป default ของ definition
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/workflows/{instance_id}/start-review"))
                .header(AUTHORIZATION, format!("Bearer {}", ctx.owner_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/workflows/{instance_id}/advance"))
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {}", ctx.owner_token))
                .body(Body::from(json!({}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_body(response).await["status"], "pending_approval");

    // manager (default approver) เห็น task ใน /approval-tasks/mine และอนุมัติได้
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/approval-tasks/mine")
                .header(AUTHORIZATION, format!("Bearer {}", ctx.manager_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let tasks = json_body(response).await;
    assert_eq!(tasks.as_array().unwrap().len(), 1);
    let task_id = tasks[0]["id"].as_str().unwrap().to_string();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/approval-tasks/{task_id}/approve"))
                .header(AUTHORIZATION, format!("Bearer {}", ctx.manager_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_body(response).await["status"], "executing");
}
