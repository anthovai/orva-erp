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
    owner_id: String,
    service_key: String,
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
                        "name": "Agent Co",
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

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/service-identities")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::from(
                    json!({
                        "name": "worker-agent",
                        "scopes": [
                            "agent:context:read",
                            "agent:workflow:read",
                            "agent:workflow:propose",
                        ],
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let service_key = json_body(response).await["api_key"]
        .as_str()
        .unwrap()
        .to_string();

    Ctx {
        owner_token,
        owner_id,
        service_key,
    }
}

/// M8 DoD: "external agent ต่อผ่าน Agent API ด้วย service identity ได้" — auth จริงด้วย
/// `X-Orva-Service-Key` (ไม่ใช่ user session), ตัวตนตรงกับ service identity ที่ owner ออกให้
#[tokio::test]
async fn agent_authenticates_with_service_identity() {
    let state = support::test_state().await;
    let app = orva_core::app(state);
    let ctx = setup(&app, "agent-auth").await;

    // ไม่มี key เลย — 401
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/agent/context")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    // key ปลอม — 401
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/agent/context")
                .header("X-Orva-Service-Key", "not-a-real-key")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    // key จริง — ผ่าน และเห็นชื่อ service identity ของตัวเอง
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/agent/context")
                .header("X-Orva-Service-Key", &ctx.service_key)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let context = json_body(response).await;
    assert_eq!(context["name"], "worker-agent");
}

/// M8 DoD: "approval hook เข้า Workflow Engine" — agent เสนอ action ที่มีเงื่อนไข approval
/// ต้องรอ human อนุมัติผ่าน endpoint เดิม (`/approval-tasks/.../approve`) ก่อนถึงจะ Executing
#[tokio::test]
async fn agent_proposed_action_requires_human_approval_before_executing() {
    let state = support::test_state().await;
    let app = orva_core::app(state);
    let ctx = setup(&app, "agent-approval").await;

    // agent เสนอ action ที่มี rule trigger การขออนุมัติ + มอบให้ owner อนุมัติ
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/agent/workflows")
                .header("content-type", "application/json")
                .header("X-Orva-Service-Key", &ctx.service_key)
                .body(Body::from(
                    json!({
                        "resource_type": "agent_action",
                        "resource_id": uuid::Uuid::new_v4(),
                        "context": { "amount": 200000 },
                        "rule": { "field": "amount", "operator": "gt", "value": 100000 },
                        "approver_id": ctx.owner_id,
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
    assert_eq!(workflow["status"], "pending_approval");

    // agent poll สถานะของตัวเอง — ยังรออยู่
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/agent/workflows/{workflow_id}"))
                .header("X-Orva-Service-Key", &ctx.service_key)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(json_body(response).await["status"], "pending_approval");

    // owner (human) เห็นงานรออนุมัติผ่าน endpoint เดิมของ user
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/approval-tasks/mine")
                .header(AUTHORIZATION, format!("Bearer {}", ctx.owner_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let tasks = json_body(response).await;
    let task_id = tasks.as_array().unwrap()[0]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // owner อนุมัติผ่าน endpoint เดิม (ไม่ใช่ endpoint ของ agent — คนละช่องทางแต่ workflow เดียวกัน)
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
    assert_eq!(response.status(), StatusCode::OK);

    // agent poll ซ้ำ — เห็นว่าอนุมัติแล้ว ทำต่อได้
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/agent/workflows/{workflow_id}"))
                .header("X-Orva-Service-Key", &ctx.service_key)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(json_body(response).await["status"], "executing");
}

/// action ที่ไม่มี rule (หรือไม่ trigger) agent ทำต่อได้ทันทีไม่ต้องรอ human
#[tokio::test]
async fn agent_proposed_action_without_rule_executes_immediately() {
    let state = support::test_state().await;
    let app = orva_core::app(state);
    let ctx = setup(&app, "agent-noapproval").await;

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/agent/workflows")
                .header("content-type", "application/json")
                .header("X-Orva-Service-Key", &ctx.service_key)
                .body(Body::from(
                    json!({
                        "resource_type": "agent_action",
                        "resource_id": uuid::Uuid::new_v4(),
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    assert_eq!(json_body(response).await["status"], "executing");
}

/// ADR 0011: key ถูกต้องอย่างเดียวไม่พอ — ต้องมี scope ตรงกับสิ่งที่ทำด้วย
/// (fail-closed: ไม่ระบุ scope = ทำอะไรไม่ได้เลย, propose จำกัดต่อ resource_type ได้)
#[tokio::test]
async fn agent_scopes_are_enforced_per_endpoint_and_resource_type() {
    let state = support::test_state().await;
    let app = orva_core::app(state);
    let ctx = setup(&app, "agent-scopes").await;

    let issue = |name: &str, scopes: serde_json::Value| {
        Request::builder()
            .method("POST")
            .uri("/api/v1/service-identities")
            .header("content-type", "application/json")
            .header(AUTHORIZATION, format!("Bearer {}", ctx.owner_token))
            .body(Body::from(
                json!({ "name": name, "scopes": scopes }).to_string(),
            ))
            .unwrap()
    };

    // scope มั่ว → 400 ตั้งแต่ตอนออก key (กัน typo กลายเป็น key ใบ้)
    let response = app
        .clone()
        .oneshot(issue("typo-agent", json!(["agent:workflw:propose"])))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    // key ไม่มี scope เลย (fail-closed) — auth ผ่านแต่ทุก endpoint 403
    let response = app
        .clone()
        .oneshot(issue("no-scope", json!([])))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let bare_key = json_body(response).await["api_key"]
        .as_str()
        .unwrap()
        .to_string();
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/agent/context")
                .header("X-Orva-Service-Key", &bare_key)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    // key จำกัด propose เฉพาะ resource_type "invoice"
    let response = app
        .clone()
        .oneshot(issue(
            "invoice-only",
            json!(["agent:workflow:propose:invoice"]),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let invoice_key = json_body(response).await["api_key"]
        .as_str()
        .unwrap()
        .to_string();

    let propose = |key: &str, resource_type: &str| {
        Request::builder()
            .method("POST")
            .uri("/api/v1/agent/workflows")
            .header("content-type", "application/json")
            .header("X-Orva-Service-Key", key)
            .body(Body::from(
                json!({
                    "resource_type": resource_type,
                    "resource_id": uuid::Uuid::new_v4(),
                })
                .to_string(),
            ))
            .unwrap()
    };

    // resource_type ตรง scope → ผ่าน
    let response = app
        .clone()
        .oneshot(propose(&invoice_key, "invoice"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);

    // resource_type อื่น → 403
    let response = app
        .clone()
        .oneshot(propose(&invoice_key, "purchase"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    // และ key นี้ไม่มี scope read — poll สถานะไม่ได้ด้วย
    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/agent/workflows/{}", uuid::Uuid::new_v4()))
                .header("X-Orva-Service-Key", &invoice_key)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}
