use std::future::Future;
use std::pin::Pin;

use axum::Router;
use orva_data::Pool;
use orva_error::Result;

use crate::{context::ModuleContext, manifest::ModuleManifest};

/// สัญญาที่ทุก ORVA module ต้อง implement (ARCHITECTURE.md §5)
///
/// v0.1: module compile เข้า binary เดียวกับ orva-core (ไม่ dynamic-load) — "การติดตั้ง"
/// จริง ๆ คือการเพิ่ม `Arc<dyn Module>` เข้า [`crate::ModuleRegistry`] ตอน startup
/// (`main.rs`) ส่วน "install/enable/disable per tenant" เป็น runtime state ในฐานข้อมูล
/// ที่ [`crate::RequireModulePermission`] เช็คให้อัตโนมัติทุก request
///
/// `migrate` คืน boxed future ตรง ๆ (ไม่ใช้ `async fn`) เพราะ trait นี้ต้อง dyn-compatible
/// สำหรับ `Vec<Arc<dyn Module>>` ใน [`crate::ModuleRegistry`]
pub trait Module: Send + Sync {
    fn manifest(&self) -> ModuleManifest;

    /// รัน migration ของ module เอง (ถ้ามี schema เฉพาะทาง) — default ไม่ทำอะไร เพราะ
    /// module ที่ใช้ canonical entity ของ Core ตรง ๆ (เช่น Notes ใช้ `Document`) ไม่ต้องมี
    /// ตารางเพิ่ม
    fn migrate<'a>(
        &'a self,
        _pool: &'a Pool,
    ) -> Pin<Box<dyn Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async { Ok(()) })
    }

    fn router(&self, ctx: ModuleContext) -> Router;
}
