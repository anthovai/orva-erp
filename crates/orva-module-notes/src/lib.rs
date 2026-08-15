//! ORVA Reference Module — Notes (M7)
//!
//! พิสูจน์ Module Contract ทั้งเส้น (ARCHITECTURE.md §5) โดยไม่แก้โค้ด orva-core เลย:
//! - **Permissions**: ประกาศเองผ่าน [`Module::manifest`] แล้ว [`orva_module_sdk::ModuleRegistry`]
//!   เอาไป upsert เข้า catalog กลางให้อัตโนมัติ
//! - **Events**: publish `notes.document.created`/`notes.document.deleted` เองผ่าน `EventBus`
//!   ที่ Core ส่งมาให้ทาง [`orva_module_sdk::ModuleContext`]
//! - **Identity/Authorization**: ใช้ `RequireModulePermission` (SDK) ซึ่งเช็ค session ผ่าน
//!   `AuthService` เดียวกับที่ orva-core ใช้เอง
//! - **Database**: ใช้ canonical entity `Document` ของ Core ตรง ๆ (ไม่มี schema เพิ่ม)

mod catalog;
mod permissions;
mod routes;

use axum::Router;
use orva_module_sdk::{Module, ModuleContext, ModuleManifest, PermissionKey};

pub struct NotesModule;

impl Module for NotesModule {
    fn manifest(&self) -> ModuleManifest {
        ModuleManifest {
            name: "notes",
            version: "0.1.0",
            dependencies: &[],
            permissions: &[
                (permissions::DocumentManage::KEY, "สร้าง/ลบ note"),
                (permissions::DocumentRead::KEY, "อ่าน note"),
            ],
            events_published: &[catalog::DOCUMENT_CREATED, catalog::DOCUMENT_DELETED],
            events_subscribed: &[],
        }
    }

    fn router(&self, ctx: ModuleContext) -> Router {
        routes::router().with_state(ctx)
    }
}
