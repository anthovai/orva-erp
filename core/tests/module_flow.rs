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

/// M7 DoD: "reference module ติดตั้งผ่าน module system, ใช้ identity/permission/event
/// ของ Core ครบ โดยไม่แตะโค้ด Core" — ทดสอบผ่าน orva-core จริง (ไม่ใช่แค่ crate เดี่ยว ๆ)
#[tokio::test]
async fn notes_module_is_listed_installable_and_gated_end_to_end() {
    let state = support::test_state().await;
    let app = orva_core::app(state);

    // provision org — owner ได้ core.module.manage มาด้วย (ทุก permission ใน catalog ปัจจุบัน)
    let suffix = uuid::Uuid::new_v4();
    let slug = format!("module-flow-{suffix}");
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/organizations")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "Module Flow Co",
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

    // 1. Module Contract: GET /api/v1/modules ต้องเห็น "notes" ที่ compile เข้ามาแล้ว
    // พร้อม manifest ครบ (permissions/events ที่มันประกาศเอง) และยังไม่ได้ install ให้ org นี้
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/modules")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let modules = json_body(response).await;
    let notes = modules
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["name"] == "notes")
        .expect("notes module must be listed");
    assert!(notes["installed"].is_null());
    assert!(notes["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p == "notes.document.manage"));
    assert!(notes["events_published"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e == "notes.document.created"));

    // 2. ก่อน install — เรียก route ของ module ตรง ๆ ต้องโดนปฏิเสธ (ไม่ได้ install)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/modules/notes/documents")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::from(json!({ "title": "x" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    // 3. install ผ่าน Core API จริง (core.module.manage)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/modules/notes/install")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    // owner ได้ทุก permission ใน catalog ตอน provisioning (รวม notes.document.manage/read
    // ที่ ModuleRegistry.initialize() upsert เข้า catalog ไว้ตั้งแต่ AppState สร้างเสร็จ
    // — ก่อนที่ org นี้จะถูก provision ด้วยซ้ำ) จึงสร้าง note ได้ทันทีหลัง install ไม่ต้อง
    // grant permission เพิ่มเอง — พิสูจน์ "ใช้ ... permission ของ Core ครบ" แบบเนียนสนิท
    // กับระบบ permission เดิม ไม่ใช่กลไกแยกของ module
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/modules/notes/documents")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::from(
                    json!({ "title": "Meeting notes", "content": "..." }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let doc_id = json_body(response).await["id"]
        .as_str()
        .unwrap()
        .to_string();

    // 4b. สมาชิกธรรมดาที่ไม่มี role (สมัครผ่าน /register เฉย ๆ) ต้องโดนปฏิเสธแม้ module
    // จะ install แล้วก็ตาม — พิสูจน์ว่า permission check ของ module แยกจาก install check จริง
    let member_email = format!("member-{suffix}@test.local");
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
                        "email": member_email,
                        "display_name": "Member",
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
                        "organization_slug": slug,
                        "email": member_email,
                        "password": "correct-horse-battery",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let member_token = json_body(response).await["access_token"]
        .as_str()
        .unwrap()
        .to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/modules/notes/documents")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {member_token}"))
                .body(Body::from(json!({ "title": "should fail" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    // 5. Event ของ module ต้องเห็นผ่าน Core audit API เดียวกับ event อื่น ๆ (ไม่ใช่ event
    // bus แยกของ module) — พิสูจน์ "ใช้ ... event ของ Core ครบ"
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/events?event_type=notes.document.created")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let events = json_body(response).await;
    assert_eq!(events.as_array().unwrap().len(), 1);
    assert_eq!(events[0]["payload"]["document_id"], doc_id);

    // 6. disable module — route ต้องกลับไปโดนปฏิเสธอีกครั้งแม้ permission ยังอยู่ครบ
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/modules/notes/disable")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/modules/notes/documents")
                .header(AUTHORIZATION, format!("Bearer {owner_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}
