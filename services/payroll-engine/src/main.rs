//! Orva payroll engine — the first Rust sidecar service.
//!
//! Deliberately outside the Open Mercato upstream contract: the TypeScript
//! app calls it over HTTP (PAYROLL_ENGINE_URL), so upstream upgrades never
//! touch it and the calculation core stays a compiled, unit-tested binary.
//!
//!   GET  /health           -> { ok, service, version }
//!   POST /calculate        -> PayrollResult (400 on invalid input)
//!
//! Run: cargo run --release   (listens on 127.0.0.1:8701, PORT env overrides)

mod calc;

use axum::{
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
struct CalculateRequest {
    employees: Vec<calc::EmployeeInput>,
}

async fn health() -> Json<Value> {
    Json(json!({
        "ok": true,
        "service": "orva-payroll-engine",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

async fn calculate(Json(body): Json<CalculateRequest>) -> Result<Json<calc::PayrollResult>, (StatusCode, Json<Value>)> {
    calc::calculate(&body.employees)
        .map(Json)
        .map_err(|message| (StatusCode::BAD_REQUEST, Json(json!({ "error": message }))))
}

#[tokio::main]
async fn main() {
    let port: u16 = std::env::var("PORT").ok().and_then(|value| value.parse().ok()).unwrap_or(8701);
    let app = Router::new()
        .route("/health", get(health))
        .route("/calculate", post(calculate));
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .expect("payroll engine: failed to bind");
    println!("orva-payroll-engine listening on 127.0.0.1:{port}");
    axum::serve(listener, app).await.expect("payroll engine: server error");
}
