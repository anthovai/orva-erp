use std::sync::Arc;

use orva_auth::{AuthConfig, AuthService, JwtKeys};
use orva_data::{
    EventRepository, ExternalModuleRepository, InsightRepository, IntelligenceRuleRepository, Pool,
    RecommendationRepository,
};
use orva_events::EventBus;
use orva_intelligence::IntelligenceEngine;
use orva_module_sdk::{ModuleContext, ModuleRegistry};
use orva_notifications::{
    subscribe_workflow_approval_requests, Mailer, NotificationHub, NotificationService,
};
use orva_workflow::WorkflowService;

use crate::rate_limit::{self, KeyedLimiter, TenantRateLimiter};

pub const DEFAULT_REQUESTS_PER_MINUTE: u32 = 100;

#[derive(Clone)]
pub struct AppState {
    pub auth: Arc<AuthService>,
    pub workflow: Arc<WorkflowService>,
    pub notifications: Arc<NotificationService>,
    pub issuer: String,
    /// JWKS document (`{"keys": [...]}`) — เสิร์ฟตรง ๆ ที่ `/.well-known/jwks.json` (ADR 0006)
    pub jwks: serde_json::Value,
    pub rate_limiter: Arc<KeyedLimiter>,
    /// rate limit ระดับองค์กร (ADR 0012) — บังคับใน auth extractor หลังรู้ tenant แล้ว
    pub tenant_limiter: Arc<TenantRateLimiter>,
    /// query ย้อนหลังโดยตรง (ไม่ผ่าน pub/sub) — ใช้โดย `GET /api/v1/events`
    pub events: EventRepository,
    /// เก็บไว้ให้ business module ในอนาคตมา `subscribe`/`subscribe_all` ทีหลังได้
    pub event_bus: EventBus,
    /// module ที่ compile เข้า binary นี้ (M7) — "ติดตั้ง" = เพิ่มเข้านี่ตอน `AppState::new`
    pub modules: Arc<ModuleRegistry>,
    /// สิ่งที่ทุก module router ต้องใช้ (pool/auth/events) — ดู `orva_module_sdk::ModuleContext`
    pub module_context: ModuleContext,
    /// M8 — จัดการ intelligence rule (CRUD) และ query insight ย้อนหลัง
    pub intelligence_rules: IntelligenceRuleRepository,
    pub insights: InsightRepository,
    /// ADR 0010 — recommendation ที่รอมนุษย์ accept/dismiss
    pub recommendations: RecommendationRepository,
    /// ADR 0013 — broadcast hub ให้ SSE stream (`GET /api/v1/notifications/stream`)
    pub notification_hub: NotificationHub,
    /// ADR 0014 — OSS module ที่รันแยก process (proxy ผ่าน `/api/v1/ext/{name}/...`)
    pub external_modules: ExternalModuleRepository,
    /// HTTP client สำหรับ proxy ไป external module (connection pool ใช้ร่วมทุก request)
    pub http_client: reqwest::Client,
}

impl AppState {
    pub async fn new(pool: Pool, keys: JwtKeys, issuer: &str) -> Self {
        Self::with_options(pool, keys, issuer, DEFAULT_REQUESTS_PER_MINUTE, None).await
    }

    /// ใช้ตอน test ที่ต้องการ quota ต่ำ ๆ เพื่อพิสูจน์ 429 ได้โดยไม่ต้องยิงร้อยครั้ง
    pub async fn with_rate_limit(
        pool: Pool,
        keys: JwtKeys,
        issuer: &str,
        requests_per_minute: u32,
    ) -> Self {
        Self::with_options(pool, keys, issuer, requests_per_minute, None).await
    }

    /// จุดประกอบเต็มรูปแบบ — `mailer` = `None` คือไม่ส่งอีเมลจริง (ADR 0008)
    pub async fn with_options(
        pool: Pool,
        keys: JwtKeys,
        issuer: &str,
        requests_per_minute: u32,
        mailer: Option<Arc<dyn Mailer>>,
    ) -> Self {
        let jwks = serde_json::json!({ "keys": [keys.public_jwk.clone()] });
        let event_bus = EventBus::new(pool.clone());
        let auth = Arc::new(AuthService::new(
            pool.clone(),
            AuthConfig {
                keys,
                issuer: issuer.to_string(),
            },
            event_bus.clone(),
        ));
        let workflow = WorkflowService::new(pool.clone(), event_bus.clone());
        let notification_hub = NotificationHub::new();
        let notifications = Arc::new(NotificationService::with_options(
            pool.clone(),
            mailer,
            notification_hub.clone(),
        ));

        // M6 DoD: "มี notification แจ้งผู้อนุมัติ" — ผูกตอนสร้าง AppState ครั้งเดียว
        subscribe_workflow_approval_requests(&event_bus, notifications.clone());

        // M8 — Intelligence Engine subscribe ทุก event เพื่อประเมิน rule แบบ real-time
        // (ไม่มี scheduler — evaluate ทันทีที่ event ที่เกี่ยวข้องเกิดขึ้น)
        let intelligence_engine =
            Arc::new(IntelligenceEngine::new(pool.clone(), notifications.clone()));
        orva_intelligence::subscribe(intelligence_engine, &event_bus);

        // M7 — รายชื่อ module ที่ compile เข้า binary นี้ ("การติดตั้ง" ระดับ binary — ดู
        // `orva_module_sdk::Module` doc comment) เพิ่ม module ใหม่แค่ `.register(...)` ตรงนี้
        // จุดเดียว ไม่ต้องแตะ routes.rs/permissions.rs ของ Core เลย
        let mut registry = ModuleRegistry::new();
        registry.register(Arc::new(orva_module_notes::NotesModule));
        registry
            .initialize(&pool)
            .await
            .expect("module registry initialization failed");
        let module_context = ModuleContext::new(pool.clone(), auth.clone(), event_bus.clone());

        Self {
            auth,
            workflow: Arc::new(workflow),
            notifications,
            issuer: issuer.to_string(),
            jwks,
            rate_limiter: rate_limit::new_limiter(requests_per_minute),
            tenant_limiter: Arc::new(TenantRateLimiter::new(
                pool.clone(),
                rate_limit::DEFAULT_TENANT_REQUESTS_PER_MINUTE,
            )),
            events: EventRepository::new(pool.clone()),
            event_bus,
            modules: Arc::new(registry),
            module_context,
            intelligence_rules: IntelligenceRuleRepository::new(pool.clone()),
            insights: InsightRepository::new(pool.clone()),
            recommendations: RecommendationRepository::new(pool.clone()),
            notification_hub,
            external_modules: ExternalModuleRepository::new(pool),
            http_client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("build http client"),
        }
    }
}
