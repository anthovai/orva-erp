use std::net::SocketAddr;
use std::num::NonZeroU32;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{header::AUTHORIZATION, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use governor::clock::DefaultClock;
use governor::state::keyed::DefaultKeyedStateStore;
use governor::{Quota, RateLimiter};
use serde_json::json;

use crate::state::AppState;

pub type KeyedLimiter = RateLimiter<String, DefaultKeyedStateStore<String>, DefaultClock>;

/// key ด้วย bearer token ก่อน (proxy ของ "user" — DoD ต้องการ rate limit ต่อ user/tenant)
/// ตกไป IP ถ้าไม่มี token (route สาธารณะอย่าง login/register/provision) แล้วตกไป "anonymous"
/// ถ้าไม่มี ConnectInfo เลย (เช่นตอน test เรียก router ตรง ๆ ผ่าน `oneshot` โดยไม่มี TCP จริง)
fn rate_limit_key(req: &Request<Body>) -> String {
    if let Some(auth) = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
    {
        return format!("token:{auth}");
    }
    if let Some(ConnectInfo(addr)) = req.extensions().get::<ConnectInfo<SocketAddr>>() {
        return format!("ip:{}", addr.ip());
    }
    "anonymous".to_string()
}

pub fn new_limiter(requests_per_minute: u32) -> Arc<KeyedLimiter> {
    let quota = Quota::per_minute(NonZeroU32::new(requests_per_minute).unwrap_or(NonZeroU32::MIN));
    Arc::new(RateLimiter::keyed(quota))
}

pub async fn enforce(State(state): State<AppState>, req: Request<Body>, next: Next) -> Response {
    let key = rate_limit_key(&req);
    if state.rate_limiter.check_key(&key).is_err() {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({ "error": "rate limit exceeded" })),
        )
            .into_response();
    }
    next.run(req).await
}
