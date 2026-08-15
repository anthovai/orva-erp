use std::sync::Arc;

use orva_auth::AuthService;
use orva_data::{ModuleInstallationRepository, Pool};
use orva_events::EventBus;

/// สิ่งที่ module ต้องการจาก Core เพื่อสร้าง handler ของตัวเอง — Core ส่งเข้ามาตอนสร้าง
/// router ของแต่ละ module ใน [`crate::ModuleRegistry::router`] โดย module ไม่ต้องรู้จัก
/// `AppState` ของ orva-core เลย (decoupling — module compile แยกจาก orva-core ได้)
#[derive(Clone)]
pub struct ModuleContext {
    pub pool: Pool,
    pub auth: Arc<AuthService>,
    pub events: EventBus,
    pub installations: ModuleInstallationRepository,
}

impl ModuleContext {
    pub fn new(pool: Pool, auth: Arc<AuthService>, events: EventBus) -> Self {
        Self {
            installations: ModuleInstallationRepository::new(pool.clone()),
            pool,
            auth,
            events,
        }
    }
}
