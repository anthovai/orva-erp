//! ADR 0014: HTTP adapter สำหรับ OSS module — test นี้เล่นบท "Horilla จำลอง":
//! spin server จริงบน ephemeral port, ลงทะเบียนเป็น external module, แล้วพิสูจน์ว่า
//! proxy แนบ identity assertion ที่ verify ได้จาก JWKS ของ ORVA จริง

mod support;

use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::http::{header::AUTHORIZATION, HeaderMap, Request, StatusCode};
use axum::routing::get;
use serde_json::{json, Value};
use tower::util::ServiceExt;

async fn json_body(response: axum::response::Response) -> Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

/// "Horilla จำลอง" — echo path/method + เก็บ header ที่ได้รับไว้ให้ test ตรวจ
async fn spawn_fake_module() -> (String, Arc<Mutex<Vec<(String, String)>>>) {
    let seen_headers: Arc<Mutex<Vec<(String, String)>>> = Arc::new(Mutex::new(Vec::new()));
    let seen = seen_headers.clone();

    let app = axum::Router::new().route(
        "/{*path}",
        get(
            move |headers: HeaderMap, path: axum::extract::Path<String>| {
                let seen = seen.clone();
                async move {
                    let mut captured = seen.lock().unwrap();
                    for (k, v) in headers.iter() {
                        captured.push((k.to_string(), v.to_str().unwrap_or("").to_string()));
                    }
                    axum::Json(json!({ "fake_module": true, "path": *path }))
                }
            },
        )
        .post(|| async { (StatusCode::CREATED, axum::Json(json!({ "created": true }))) }),
    );

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{addr}"), seen_headers)
}

#[tokio::test]
async fn proxy_forwards_with_jwks_verifiable_identity_assertion() {
    let state = support::test_state().await;
    let app = orva_core::app(state);
    let (fake_url, seen_headers) = spawn_fake_module().await;

    // provision org
    let suffix = uuid::Uuid::new_v4();
    let slug = format!("ext-flow-{suffix}");
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/organizations")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "Ext Co",
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
    let token = json_body(response).await["access_token"]
        .as_str()
        .unwrap()
        .to_string();

    // ลงทะเบียน fake module เป็น "horilla"
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/external-modules")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::from(
                    json!({ "name": "horilla", "base_url": fake_url }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);

    // module ที่ไม่มีจริง → 404
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/ext/nope/api/employees")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    // proxy ผ่านจริง — response ของ module ส่งกลับตรง ๆ
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/ext/horilla/api/employees?dept=hr")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["fake_module"], true);
    assert_eq!(body["path"], "api/employees");

    // module ปลายทางต้องได้ identity assertion ที่ verify ผ่าน JWKS ของ ORVA ได้จริง
    let assertion = {
        let headers = seen_headers.lock().unwrap();
        assert!(
            !headers.iter().any(|(k, _)| k == "authorization"),
            "session token ของ user ห้ามรั่วไปถึง module ปลายทาง"
        );
        assert!(headers.iter().any(|(k, _)| k == "x-orva-organization-id"));
        headers
            .iter()
            .find(|(k, _)| k == "x-orva-identity")
            .expect("identity assertion header")
            .1
            .clone()
    };

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/.well-known/jwks.json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let jwk = json_body(response).await["keys"][0].clone();
    let key = jsonwebtoken::DecodingKey::from_rsa_components(
        jwk["n"].as_str().unwrap(),
        jwk["e"].as_str().unwrap(),
    )
    .unwrap();
    let mut validation = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::RS256);
    validation.set_audience(&["orva-module:horilla"]);
    let claims = jsonwebtoken::decode::<Value>(&assertion, &key, &validation)
        .expect("assertion must verify against ORVA JWKS")
        .claims;
    assert!(claims["email"]
        .as_str()
        .unwrap()
        .starts_with(&format!("owner-{suffix}")));

    // disable แล้ว proxy ต้อง 404 ทันที
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/external-modules/horilla/disable")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/ext/horilla/api/employees")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

/// ADR 0014: external module publish event กลับเข้า ORVA — ต้องมี scope
/// `agent:event:publish` และ event เข้า audit log ให้ query กลับได้
#[tokio::test]
async fn external_module_publishes_event_with_scope() {
    let state = support::test_state().await;
    let app = orva_core::app(state);

    let suffix = uuid::Uuid::new_v4();
    let slug = format!("ext-event-{suffix}");
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/organizations")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "ExtEvent Co",
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
    let token = json_body(response).await["access_token"]
        .as_str()
        .unwrap()
        .to_string();

    // key ไม่มี scope publish → 403
    let issue = |scopes: Value| {
        Request::builder()
            .method("POST")
            .uri("/api/v1/service-identities")
            .header("content-type", "application/json")
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .body(Body::from(
                json!({ "name": "horilla-svc", "scopes": scopes }).to_string(),
            ))
            .unwrap()
    };
    let response = app
        .clone()
        .oneshot(issue(json!(["agent:context:read"])))
        .await
        .unwrap();
    let bare_key = json_body(response).await["api_key"]
        .as_str()
        .unwrap()
        .to_string();
    let publish = |key: &str| {
        Request::builder()
            .method("POST")
            .uri("/api/v1/agent/events")
            .header("content-type", "application/json")
            .header("X-Orva-Service-Key", key)
            .body(Body::from(
                json!({
                    "event_type": "horilla.employee.created",
                    "payload": {"employee_id": "e-1"},
                })
                .to_string(),
            ))
            .unwrap()
    };
    let response = app.clone().oneshot(publish(&bare_key)).await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    // key ที่มี scope → 201 และ event query กลับได้จาก audit log
    let response = app
        .clone()
        .oneshot(issue(json!(["agent:event:publish"])))
        .await
        .unwrap();
    let key = json_body(response).await["api_key"]
        .as_str()
        .unwrap()
        .to_string();
    let response = app.clone().oneshot(publish(&key)).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    assert_eq!(
        json_body(response).await["event_type"],
        "horilla.employee.created"
    );

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/events?event_type=horilla.employee.created")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let events = json_body(response).await;
    assert_eq!(events.as_array().unwrap().len(), 1);
}

/// ADR 0016: canonical Employee projection — event `<module>.employee.*` จาก Agent API
/// ถูก project ลงตาราง employees อัตโนมัติ (upsert idempotent + soft delete)
#[tokio::test]
async fn employee_events_project_into_canonical_table() {
    let state = support::test_state().await;
    let app = orva_core::app(state);

    let suffix = uuid::Uuid::new_v4();
    let slug = format!("emp-sync-{suffix}");
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/organizations")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "EmpSync Co",
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
    let token = json_body(response).await["access_token"]
        .as_str()
        .unwrap()
        .to_string();

    // service key สำหรับ "Horilla" publish event
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/service-identities")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::from(
                    json!({ "name": "horilla-events", "scopes": ["agent:event:publish"] })
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let key = json_body(response).await["api_key"]
        .as_str()
        .unwrap()
        .to_string();

    let publish = |event_type: &str, payload: Value, key: &str| {
        Request::builder()
            .method("POST")
            .uri("/api/v1/agent/events")
            .header("content-type", "application/json")
            .header("X-Orva-Service-Key", key)
            .body(Body::from(
                json!({ "event_type": event_type, "payload": payload }).to_string(),
            ))
            .unwrap()
    };

    // created → มีแถว canonical
    let response = app
        .clone()
        .oneshot(publish(
            "horilla.employee.created",
            json!({"source_id": "11", "email": "somchai@empsync.test", "first_name": "Somchai", "last_name": "D", "is_active": true}),
            &key,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);

    let list_employees = || {
        Request::builder()
            .uri("/api/v1/employees")
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap()
    };
    let employees = json_body(app.clone().oneshot(list_employees()).await.unwrap()).await;
    assert_eq!(employees.as_array().unwrap().len(), 1);
    assert_eq!(employees[0]["email"], "somchai@empsync.test");
    assert_eq!(employees[0]["source_module"], "horilla");
    assert_eq!(employees[0]["source_id"], "11");

    // updated ที่ source_id เดิม → upsert ไม่เพิ่มแถว แต่ค่าใหม่
    let response = app
        .clone()
        .oneshot(publish(
            "horilla.employee.updated",
            json!({"source_id": "11", "email": "somchai@empsync.test", "first_name": "Somchai", "last_name": "Deelert", "is_active": false}),
            &key,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let employees = json_body(app.clone().oneshot(list_employees()).await.unwrap()).await;
    assert_eq!(employees.as_array().unwrap().len(), 1);
    assert_eq!(employees[0]["last_name"], "Deelert");
    assert_eq!(employees[0]["is_active"], false);

    // deleted → หายจาก list (soft delete)
    let response = app
        .clone()
        .oneshot(publish(
            "horilla.employee.deleted",
            json!({"source_id": "11"}),
            &key,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let employees = json_body(app.clone().oneshot(list_employees()).await.unwrap()).await;
    assert_eq!(employees.as_array().unwrap().len(), 0);

    // event ที่ไม่เข้า contract (ไม่มี source id) — ห้ามทำอะไรพัง แค่ถูกข้าม
    let response = app
        .oneshot(publish(
            "horilla.employee.created",
            json!({"email": "no-id@empsync.test"}),
            &key,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
}

/// ADR 0016: canonical Product projection — contract เดียวกับ Employee
/// (`<module>.product.*`) ใช้ได้กับ module ใหม่โดยไม่แก้โค้ด ORVA
#[tokio::test]
async fn product_events_project_into_canonical_table() {
    let state = support::test_state().await;
    let app = orva_core::app(state);

    let suffix = uuid::Uuid::new_v4();
    let slug = format!("prod-sync-{suffix}");
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/organizations")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "ProdSync Co",
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
    let token = json_body(response).await["access_token"]
        .as_str()
        .unwrap()
        .to_string();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/service-identities")
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::from(
                    json!({ "name": "inventree-events", "scopes": ["agent:event:publish"] })
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let key = json_body(response).await["api_key"]
        .as_str()
        .unwrap()
        .to_string();

    // created via "inventree" module
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/agent/events")
                .header("content-type", "application/json")
                .header("X-Orva-Service-Key", &key)
                .body(Body::from(
                    json!({
                        "event_type": "inventree.product.created",
                        "payload": {"source_id": "101", "name": "M3 Bolt", "sku": "BOLT-M3", "description": "Stainless", "is_active": true},
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/products")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let products = json_body(response).await;
    assert_eq!(products.as_array().unwrap().len(), 1);
    assert_eq!(products[0]["name"], "M3 Bolt");
    assert_eq!(products[0]["sku"], "BOLT-M3");
    assert_eq!(products[0]["source_module"], "inventree");
    assert_eq!(products[0]["source_id"], "101");
}
