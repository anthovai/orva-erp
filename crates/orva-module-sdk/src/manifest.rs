/// Module Contract (ARCHITECTURE.md §5): `Manifest, Version, Dependencies, Permissions,
/// APIs, Events, Database, UI, Configuration` — v0.1 ครอบเฉพาะส่วนที่มีความหมายจริงตอนนี้
/// (Manifest/Version/Dependencies/Permissions/Events) ส่วน APIs มาจาก [`crate::Module::router`]
/// เอง, Database มาจาก migration ที่ module รันเอง (ดู [`crate::Module::migrate`]),
/// UI/Configuration ยังไม่มีความหมายจนกว่าจะมี Unified UI (Phase หลัง v0.1)
#[derive(Debug, Clone)]
pub struct ModuleManifest {
    pub name: &'static str,
    pub version: &'static str,
    pub dependencies: &'static [&'static str],
    /// (key, description) — module ประกาศ permission ของตัวเองผ่านตรงนี้ ไม่ใช่แก้ migration
    /// ของ Core (ดู `ModuleRegistry::install_permissions`)
    pub permissions: &'static [(&'static str, &'static str)],
    pub events_published: &'static [&'static str],
    pub events_subscribed: &'static [&'static str],
}
