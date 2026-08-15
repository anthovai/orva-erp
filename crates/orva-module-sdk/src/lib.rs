//! ORVA Module SDK (M7) — สิ่งที่ทุก business module ต้องใช้ร่วมกับ Core
//!
//! ดู ARCHITECTURE.md §5 (Module System) — crate นี้เป็นจุดต่อเดียวระหว่าง orva-core
//! กับ module ใด ๆ ในอนาคต (Notes, HRM, Finance, ...) module ไม่ต้อง depend บน
//! `orva-core` เลย ต้องพึ่งแค่ crate นี้ + `orva-data`/`orva-auth`/`orva-events` โดยตรง

mod context;
mod extractor;
mod manifest;
mod module;
mod registry;

pub use context::ModuleContext;
pub use extractor::{
    ModuleApiError, ModulePermission, ModuleUser, PermissionKey, RequireModulePermission,
};
pub use manifest::ModuleManifest;
pub use module::Module;
pub use registry::ModuleRegistry;
