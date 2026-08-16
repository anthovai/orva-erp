//! ADR 0018: AI ใน Intelligence Engine — ทดสอบผ่าน HTTP ด้วย stub analyst
//! (CI ไม่ยิง Anthropic จริง): analyze → ได้ analysis + recommendation source=ai
//! ที่เข้า loop accept/dismiss ปกติ; ไม่ config AI → 400

mod support;

use std::sync::Arc;

use axum::body::Body;
use axum::http::{header::AUTHORIZATION, Request, StatusCode};
use orva_intelligence::{AiAnalysis, AiRecommendation, Analyst};
use serde_json::{json, Value};
use tower::util::ServiceExt;

struct StubAnalyst;

impl Analyst for StubAnalyst {
    fn analyze<'a>(
        &'a self,
        context: &'a Value,
        question: Option<&'a str>,
    ) -> orva_intelligence::BoxFuture<'a, orva_error::Result<AiAnalysis>> {
        // ยืนยันว่า core รวบรวม context จริงมาให้ (ไม่ใช่ JSON เปล่า)
        assert!(context.get("event_counts_last_7_days").is_some());
        assert!(context.get("employee_count").is_some());
        let question = question.unwrap_or("").to_string();
        Box::pin(async move {
            Ok(AiAnalysis {
                analysis: format!("stub analysis for: {question}"),
                recommendation: Some(AiRecommendation {
                    title: "Review supplier X".to_string(),
                    description: "Order events dropped sharply this week".to_string(),
                }),
            })
        })
    }
}

async fn json_body(response: axum::response::Response) -> Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn provision_org(app: &axum::Router, slug_prefix: &str) -> String {
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
                        "name": "AI Co",
                        "slug": format!("{slug_prefix}-{suffix}"),
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
    json_body(response).await["access_token"]
        .as_str()
        .unwrap()
        .to_string()
}

fn analyze_request(token: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/api/v1/intelligence/analyze")
        .header("content-type", "application/json")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(body.to_string()))
        .unwrap()
}

#[tokio::test]
async fn analyze_returns_analysis_and_creates_ai_recommendation() {
    let pool = orva_data::connect(&support::test_database_url())
        .await
        .expect("connect to test database");
    orva_data::migrate(&pool).await.expect("run migrations");
    let state = orva_core::AppState::with_options(
        pool,
        support::test_keys(),
        "orva-core-test",
        100,
        None,
        Some(Arc::new(StubAnalyst)),
    )
    .await;
    let app = orva_core::app(state);

    let token = provision_org(&app, "ai").await;

    let response = app
        .clone()
        .oneshot(analyze_request(
            &token,
            json!({ "question": "why did orders drop?" }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["analysis"], "stub analysis for: why did orders drop?");
    let rec = &body["recommendation"];
    assert_eq!(rec["source"], "ai");
    assert_eq!(rec["title"], "Review supplier X");
    assert!(rec["insight_id"].is_null());
    assert!(rec["rule_id"].is_null());
    let rec_id = rec["id"].as_str().unwrap().to_string();

    // recommendation ของ AI โผล่ใน list ปกติ และ accept ได้เหมือน recommendation จาก rule
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/recommendations?status=pending")
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let listed = json_body(response).await;
    assert!(listed
        .as_array()
        .unwrap()
        .iter()
        .any(|r| r["id"] == rec_id.as_str()));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/recommendations/{rec_id}/accept"))
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let accepted = json_body(response).await;
    assert_eq!(accepted["status"], "accepted");
    // ไม่มี suggested_action → ไม่มี workflow ถูกสร้าง
    assert!(accepted["resulting_workflow_id"].is_null());
}

#[tokio::test]
async fn analyze_without_ai_configured_returns_400() {
    let state = support::test_state().await; // analyst = None
    let app = orva_core::app(state);
    let token = provision_org(&app, "noai").await;

    let response = app
        .oneshot(analyze_request(&token, json!({})))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
