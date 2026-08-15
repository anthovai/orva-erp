use std::collections::HashMap;
use std::net::SocketAddr;
use std::num::NonZeroU32;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{header::AUTHORIZATION, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use governor::clock::DefaultClock;
use governor::state::keyed::DefaultKeyedStateStore;
use governor::state::{InMemoryState, NotKeyed};
use governor::{Quota, RateLimiter};
use orva_data::{OrganizationRepository, Pool};
use orva_error::{Error, Result};
use serde_json::json;
use uuid::Uuid;

use crate::state::AppState;

pub type KeyedLimiter = RateLimiter<String, DefaultKeyedStateStore<String>, DefaultClock>;

type DirectLimiter = RateLimiter<NotKeyed, InMemoryState, DefaultClock>;

/// default ต่อองค์กร (ADR 0012) — ตั้งใจให้สูงกว่า per-key limit (M4) มาก เพราะรวมทุก
/// user/agent ในองค์กรเดียวกัน — override ต่อองค์กรได้ที่ `organizations.rate_limit_per_minute`
pub const DEFAULT_TENANT_REQUESTS_PER_MINUTE: u32 = 1000;

/// quota ที่อ่านจาก DB ถูก cache ไว้นานเท่านี้ก่อนอ่านใหม่ (การแก้ quota ผ่าน API
/// เรียก [`TenantRateLimiter::invalidate`] ตรง ๆ จึงมีผลทันทีโดยไม่ต้องรอ)
const QUOTA_CACHE_TTL: Duration = Duration::from_secs(60);

struct TenantEntry {
    quota: u32,
    limiter: Arc<DirectLimiter>,
    fetched_at: Instant,
}

/// Rate limit ระดับ**องค์กร** (ADR 0012) — บังคับหลัง auth สำเร็จ (ตอนนั้นถึงรู้ organization)
/// คนละชั้นกับ [`KeyedLimiter`] ที่กันก่อน auth ต่อ token/IP
pub struct TenantRateLimiter {
    default_per_minute: u32,
    organizations: OrganizationRepository,
    entries: RwLock<HashMap<Uuid, TenantEntry>>,
}

impl TenantRateLimiter {
    pub fn new(pool: Pool, default_per_minute: u32) -> Self {
        Self {
            default_per_minute,
            organizations: OrganizationRepository::new(pool),
            entries: RwLock::new(HashMap::new()),
        }
    }

    /// นับ 1 request ให้องค์กรนี้ — เกิน quota คืน [`Error::RateLimited`] (429)
    pub async fn check(&self, organization_id: Uuid) -> Result<()> {
        // fast path: entry ยังสดอยู่ — ไม่แตะ DB เลย
        if let Some(limiter) = {
            let entries = self.entries.read().expect("tenant limiter lock poisoned");
            entries
                .get(&organization_id)
                .and_then(|e| (e.fetched_at.elapsed() < QUOTA_CACHE_TTL).then(|| e.limiter.clone()))
        } {
            return limiter.check().map_err(|_| Error::RateLimited);
        }

        // slow path: อ่าน quota จาก DB แล้ว (re)build entry — quota เดิมคง limiter เดิมไว้
        // (ไม่ reset ตัวนับ) quota ใหม่ค่อยสร้าง limiter ใหม่
        let quota = self
            .organizations
            .find_by_id(organization_id)
            .await?
            .and_then(|org| org.rate_limit_per_minute)
            .map(|v| v.max(1) as u32)
            .unwrap_or(self.default_per_minute);

        let limiter = {
            let mut entries = self.entries.write().expect("tenant limiter lock poisoned");
            let entry = entries
                .entry(organization_id)
                .and_modify(|e| {
                    if e.quota != quota {
                        e.quota = quota;
                        e.limiter = Arc::new(RateLimiter::direct(per_minute(quota)));
                    }
                    e.fetched_at = Instant::now();
                })
                .or_insert_with(|| TenantEntry {
                    quota,
                    limiter: Arc::new(RateLimiter::direct(per_minute(quota))),
                    fetched_at: Instant::now(),
                });
            entry.limiter.clone()
        };

        limiter.check().map_err(|_| Error::RateLimited)
    }

    /// เรียกหลังแก้ quota ผ่าน API — request ถัดไปอ่านค่าใหม่จาก DB ทันที
    pub fn invalidate(&self, organization_id: Uuid) {
        self.entries
            .write()
            .expect("tenant limiter lock poisoned")
            .remove(&organization_id);
    }
}

fn per_minute(requests: u32) -> Quota {
    Quota::per_minute(NonZeroU32::new(requests).unwrap_or(NonZeroU32::MIN))
}

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
