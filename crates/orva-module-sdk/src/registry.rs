use std::sync::Arc;

use axum::Router;
use orva_data::{PermissionRepository, Pool};
use orva_error::Result;

use crate::{context::ModuleContext, manifest::ModuleManifest, module::Module};

/// รายชื่อ module ที่ compile เข้า binary นี้ (v0.1: ไม่ dynamic-load — ดู [`Module`])
#[derive(Default)]
pub struct ModuleRegistry {
    modules: Vec<Arc<dyn Module>>,
}

impl ModuleRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, module: Arc<dyn Module>) {
        self.modules.push(module);
    }

    pub fn manifests(&self) -> Vec<ModuleManifest> {
        self.modules.iter().map(|m| m.manifest()).collect()
    }

    /// เรียกครั้งเดียวตอน startup — รัน migration ของแต่ละ module แล้วให้ประกาศ
    /// permission key ของตัวเองเข้า catalog กลาง (M7 DoD: "module ประกาศ permission key
    /// ของตัวเองเข้าระบบกลาง") แบบ idempotent เรียกซ้ำได้ทุกครั้งที่ server เริ่ม
    pub async fn initialize(&self, pool: &Pool) -> Result<()> {
        let permissions = PermissionRepository::new(pool.clone());
        for module in &self.modules {
            module.migrate(pool).await?;
            for (key, description) in module.manifest().permissions {
                permissions.upsert(key, description).await?;
            }
        }
        Ok(())
    }

    /// รวม router ของทุก module ที่ลงทะเบียนไว้เป็น router เดียว
    pub fn router(&self, ctx: ModuleContext) -> Router {
        let mut router = Router::new();
        for module in &self.modules {
            router = router.merge(module.router(ctx.clone()));
        }
        router
    }
}
