use std::sync::Arc;

use axum::body::Body;
use axum::http::{header::AUTHORIZATION, Request, StatusCode};
use orva_auth::{AuthConfig, AuthService};
use orva_events::EventBus;
use orva_module_notes::NotesModule;
use orva_module_sdk::{Module, ModuleContext};
use serde_json::{json, Value};
use tower::util::ServiceExt;

fn test_database_url() -> String {
    std::env::var("ORVA_TEST_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://orva:orva@localhost:5432/orva_test".to_string())
}

async fn json_body(response: axum::response::Response) -> Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

/// M7 DoD: "reference module ติดตั้งผ่าน module system, ใช้ identity/permission/event
/// ของ Core ครบ" — ทดสอบ module นี้แบบ**เดี่ยว ๆ** โดยไม่พึ่ง orva-core เลย พิสูจน์ว่า
/// module compile แยกได้จริงและใช้แค่ SDK + orva-data/orva-auth/orva-events ตรง ๆ
#[tokio::test]
async fn notes_module_full_lifecycle_with_install_gate_and_permissions() {
    let pool = orva_data::connect(&test_database_url())
        .await
        .expect("connect to test database — is `docker compose up -d` running?");
    orva_data::migrate(&pool).await.expect("run migrations");

    let orgs = orva_data::OrganizationRepository::new(pool.clone());
    let slug = format!("notes-module-{}", uuid::Uuid::new_v4());
    let org = orgs.create("Notes Module Org", &slug).await.unwrap();

    let event_bus = EventBus::new(pool.clone());
    let auth = Arc::new(AuthService::new(
        pool.clone(),
        AuthConfig {
            jwt_secret: b"test-secret".to_vec(),
            issuer: "test".to_string(),
        },
        event_bus.clone(),
    ));

    // สมัคร user เอง (ไม่ผ่าน HTTP — ใช้ AuthService ตรง ๆ เหมือนที่ orva-core เรียก)
    let user = auth
        .register(
            &slug,
            "user@notes-module.test",
            "User",
            "correct-horse-battery",
        )
        .await
        .unwrap();
    let login = auth
        .login(&slug, "user@notes-module.test", "correct-horse-battery")
        .await
        .unwrap();
    let token = login.session_token;

    let module = NotesModule;

    // M7 DoD: "module ประกาศ permission key ของตัวเองเข้าระบบกลาง" — เรียกครั้งเดียว
    // เหมือนตอน server เริ่มทำงานจริง (registry.initialize)
    let permissions = orva_data::PermissionRepository::new(pool.clone());
    for (key, description) in module.manifest().permissions {
        permissions.upsert(key, description).await.unwrap();
    }

    let ctx = ModuleContext::new(pool.clone(), auth.clone(), event_bus.clone());
    let app = module.router(ctx.clone());

    // ยังไม่ install module ให้องค์กรนี้ — route ต้องถูกปฏิเสธแม้ user จะมี permission ก็ตาม
    // (ยังไม่มี permission เลยด้วยซ้ำในจุดนี้ — ทดสอบ "install gate" ก่อน)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/modules/notes/documents")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::from(json!({ "title": "Hello" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    // "ติดตั้ง" module ให้องค์กรนี้
    ctx.installations
        .install(org.id, "notes", "0.1.0", user.id)
        .await
        .unwrap();

    // install แล้ว แต่ยังไม่มี role/permission ใด ๆ — ยังต้องโดน 403 (คนละเหตุผล: ไม่มี permission)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/modules/notes/documents")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::from(json!({ "title": "Hello" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    // มอบ permission ให้ user (จำลอง role assignment ผ่าน data layer ตรง ๆ)
    let roles = orva_data::RoleRepository::new(pool.clone());
    let role = roles
        .create(org.id, "notes-editor", Some(user.id))
        .await
        .unwrap();
    let manage_perm = permissions
        .find_by_key("notes.document.manage")
        .await
        .unwrap()
        .unwrap();
    let read_perm = permissions
        .find_by_key("notes.document.read")
        .await
        .unwrap()
        .unwrap();
    roles
        .grant_permission(role.id, manage_perm.id)
        .await
        .unwrap();
    roles.grant_permission(role.id, read_perm.id).await.unwrap();
    roles
        .assign_to_user(org.id, role.id, user.id)
        .await
        .unwrap();

    // ตอนนี้สร้าง note ได้จริง
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/modules/notes/documents")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::from(
                    json!({ "title": "Hello", "content": "World" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let doc = json_body(response).await;
    let doc_id = doc["id"].as_str().unwrap().to_string();

    // list เห็น note ที่สร้าง
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/modules/notes/documents")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let list = json_body(response).await;
    assert_eq!(list.as_array().unwrap().len(), 1);

    // M7 DoD: event ของ module publish ผ่าน Core Event Bus จริง — query กลับผ่าน
    // EventRepository (ของ orva-data) ตรง ๆ พิสูจน์ว่าไม่ใช่ event bus แยกของ module เอง
    let events = orva_data::EventRepository::new(pool.clone())
        .list(
            org.id,
            orva_data::EventFilter {
                event_type: Some("notes.document.created"),
                ..Default::default()
            },
            10,
        )
        .await
        .unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].payload["document_id"], doc_id);

    // delete
    let response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/v1/modules/notes/documents/{doc_id}"))
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let events = orva_data::EventRepository::new(pool)
        .list(
            org.id,
            orva_data::EventFilter {
                event_type: Some("notes.document.deleted"),
                ..Default::default()
            },
            10,
        )
        .await
        .unwrap();
    assert_eq!(events.len(), 1);
}
