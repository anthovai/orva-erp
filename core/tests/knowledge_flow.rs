//! ADR 0017: ORVA Knowledge — linked notes + graph เต็มวงจรผ่าน HTTP:
//! สร้างโน้ตที่ลิงก์หาโน้ตที่ยังไม่มี → ลิงก์ค้าง → สร้างโน้ตปลายทาง → resolve
//! อัตโนมัติ + backlinks + entity links + graph

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

#[tokio::test]
async fn knowledge_notes_links_backlinks_and_graph() {
    let state = support::test_state().await;
    let app = orva_core::app(state);

    let suffix = uuid::Uuid::new_v4();
    let slug = format!("knowledge-{suffix}");
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/organizations")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "Knowledge Co",
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

    let create = |title: &str, content: &str, token: &str| {
        Request::builder()
            .method("POST")
            .uri("/api/v1/knowledge/notes")
            .header("content-type", "application/json")
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .body(Body::from(
                json!({ "title": title, "content": content }).to_string(),
            ))
            .unwrap()
    };

    // โน้ตแรกลิงก์หา "Onboarding" (ยังไม่มี) + canonical entities
    let response = app
        .clone()
        .oneshot(create(
            "Q3 Planning",
            "คุยกับ [[employee:somchai@x.test]] เรื่อง [[Onboarding]] และสั่ง [[product:BOLT-M3]]",
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let q3 = json_body(response).await;
    let q3_id = q3["id"].as_str().unwrap().to_string();
    let links = q3["links"].as_array().unwrap();
    assert_eq!(links.len(), 3);
    let note_link = links.iter().find(|l| l["target_kind"] == "note").unwrap();
    assert_eq!(note_link["target_ref"], "Onboarding");
    assert!(
        note_link["to_note_id"].is_null(),
        "ยังไม่มีโน้ตปลายทาง — ต้องค้าง"
    );
    assert!(links.iter().any(|l| l["target_kind"] == "employee"));
    assert!(links.iter().any(|l| l["target_kind"] == "product"));

    // ชื่อซ้ำ → 400
    let response = app
        .clone()
        .oneshot(create("q3 planning", "duplicate", &token))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    // สร้าง "Onboarding" → ลิงก์ค้างต้องถูก resolve อัตโนมัติ
    let response = app
        .clone()
        .oneshot(create("Onboarding", "ขั้นตอนรับพนักงานใหม่", &token))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let onboarding = json_body(response).await;
    let onboarding_id = onboarding["id"].as_str().unwrap().to_string();

    // Q3 Planning ต้องเห็นลิงก์ resolve แล้ว
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/knowledge/notes/{q3_id}"))
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let q3_detail = json_body(response).await;
    let resolved = q3_detail["links"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["target_kind"] == "note")
        .unwrap();
    assert_eq!(resolved["to_note_id"].as_str().unwrap(), onboarding_id);

    // backlinks ของ Onboarding ต้องมี Q3 Planning
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/knowledge/notes/{onboarding_id}"))
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let onboarding_detail = json_body(response).await;
    let backlinks = onboarding_detail["backlinks"].as_array().unwrap();
    assert_eq!(backlinks.len(), 1);
    assert_eq!(backlinks[0]["title"], "Q3 Planning");

    // graph: 2 note nodes + employee node + product node, 3 edges
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/knowledge/graph")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let graph = json_body(response).await;
    let nodes = graph["nodes"].as_array().unwrap();
    let edges = graph["edges"].as_array().unwrap();
    assert_eq!(nodes.iter().filter(|n| n["kind"] == "note").count(), 2);
    assert_eq!(nodes.iter().filter(|n| n["kind"] == "employee").count(), 1);
    assert_eq!(nodes.iter().filter(|n| n["kind"] == "product").count(), 1);
    assert_eq!(edges.len(), 3);

    // แก้เนื้อหา → ลิงก์ถูก parse ใหม่ (ตัดลิงก์ entity ออกหมด)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/v1/knowledge/notes/{q3_id}"))
                .header("content-type", "application/json")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::from(
                    json!({ "content": "เหลือแค่ [[Onboarding]]" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_body(response).await["links"].as_array().unwrap().len(),
        1
    );

    // ลบ Onboarding → ลิงก์จาก Q3 กลับเป็นค้าง (missing) — ความรู้ที่หายไปมองเห็นได้ใน graph
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/v1/knowledge/notes/{onboarding_id}"))
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
                .uri("/api/v1/knowledge/graph")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let graph = json_body(response).await;
    assert!(graph["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|n| n["kind"] == "missing" && n["label"] == "Onboarding"));
}
