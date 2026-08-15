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

struct ProvisionedOrg {
    slug: String,
    owner_email: String,
    owner_token: String,
}

/// slug/email สุ่มกันชนกับ run ก่อนหน้า (unique constraint) — เหมือน pattern ใน orva-data/tests/crud.rs
async fn provision(app: &axum::Router, prefix: &str) -> ProvisionedOrg {
    let suffix = uuid::Uuid::new_v4();
    let slug = format!("{prefix}-{suffix}");
    let owner_email = format!("owner-{suffix}@test.local");

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
                        "slug": slug,
                        "owner_email": owner_email,
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
    let body = json_body(response).await;
    let owner_token = body["access_token"].as_str().unwrap().to_string();

    ProvisionedOrg {
        slug,
        owner_email,
        owner_token,
    }
}

/// DoD M3: owner (มี role ทุก permission จาก provisioning) ทำ action ที่ต้อง permission ได้
/// ส่วน user ธรรมดา (สมัครผ่าน /register เฉย ๆ ไม่มี role) ทำไม่ได้ — 403
#[tokio::test]
async fn permission_is_enforced_on_protected_routes() {
    let state = support::test_state().await;
    let app = orva_core::app(state);

    let org = provision(&app, "authz-org").await;

    // owner สร้าง service identity ได้ (มี core.service_identity.manage)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/service-identities")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {}", org.owner_token))
                .body(Body::from(json!({ "name": "worker" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);

    // สมาชิกธรรมดาที่สมัครเพิ่มเข้าองค์กรเดียวกัน — ไม่มี role ใด ๆ
    let member_email = format!("member-{}@test.local", uuid::Uuid::new_v4());
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/register")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "organization_slug": org.slug,
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
                        "organization_slug": org.slug,
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

    // member ไม่มี permission → 403 ไม่ใช่ 401 (ต่างจากไม่ auth เลย)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/service-identities")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {member_token}"))
                .body(Body::from(json!({ "name": "worker-2" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    // owner มอบ role ใหม่ที่มี permission ให้ member แล้ว member ต้องทำได้
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/roles")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {}", org.owner_token))
                .body(Body::from(json!({ "name": "worker-manager" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let role = json_body(response).await;
    let role_id = role["id"].as_str().unwrap();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/roles/{role_id}/permissions"))
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {}", org.owner_token))
                .body(Body::from(
                    json!({ "permission_key": "core.service_identity.manage" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let member_id = {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/auth/me")
                    .header(AUTHORIZATION, format!("Bearer {member_token}"))
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
                .uri(format!("/api/v1/roles/{role_id}/assign"))
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {}", org.owner_token))
                .body(Body::from(json!({ "user_id": member_id }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/service-identities")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {member_token}"))
                .body(Body::from(json!({ "name": "worker-3" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
}

/// DoD M3: user ข้าม tenant ทำอะไรกันไม่ได้ — owner ขององค์กร A เอา role_id ขององค์กร B
/// มาใช้ไม่ได้ (ป้องกัน cross-tenant privilege escalation)
#[tokio::test]
async fn cross_tenant_role_operations_are_rejected() {
    let state = support::test_state().await;
    let app = orva_core::app(state);

    let org_a = provision(&app, "tenant-a").await;
    let org_b = provision(&app, "tenant-b").await;

    // role ขององค์กร B
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/roles")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {}", org_b.owner_token))
                .body(Body::from(json!({ "name": "b-role" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let role_b_id = json_body(response).await["id"]
        .as_str()
        .unwrap()
        .to_string();

    // owner ขององค์กร A พยายามให้ permission กับ role ของ B → ต้องไม่เจอ (404)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/roles/{role_b_id}/permissions"))
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {}", org_a.owner_token))
                .body(Body::from(
                    json!({ "permission_key": "core.service_identity.manage" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    // owner A พยายาม assign role ของ B ให้ตัวเอง → ต้องไม่เจอเช่นกัน
    let me_a = {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/auth/me")
                    .header(AUTHORIZATION, format!("Bearer {}", org_a.owner_token))
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
                .uri(format!("/api/v1/roles/{role_b_id}/assign"))
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {}", org_a.owner_token))
                .body(Body::from(json!({ "user_id": me_a }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn suspend_organization_requires_permission_and_blocks_future_login() {
    let state = support::test_state().await;
    let app = orva_core::app(state);

    let org = provision(&app, "suspend-org").await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/organizations/current/suspend")
                .header(AUTHORIZATION, format!("Bearer {}", org.owner_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    // องค์กรถูกระงับแล้ว — login ไม่ได้อีกต่อไป
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "organization_slug": org.slug,
                        "email": org.owner_email,
                        "password": "correct-horse-battery",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
