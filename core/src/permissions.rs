//! Marker types สำหรับ [`crate::extractor::RequirePermission`] — ต้องตรงกับ permission
//! catalog ที่ seed ไว้ใน `crates/orva-data/migrations/..._authorization.up.sql` และ `..._event_bus.up.sql`

use crate::extractor::PermissionKey;

pub struct OrganizationManage;
impl PermissionKey for OrganizationManage {
    const KEY: &'static str = "core.organization.manage";
}

pub struct RoleManage;
impl PermissionKey for RoleManage {
    const KEY: &'static str = "core.role.manage";
}

pub struct ServiceIdentityManage;
impl PermissionKey for ServiceIdentityManage {
    const KEY: &'static str = "core.service_identity.manage";
}

pub struct EventRead;
impl PermissionKey for EventRead {
    const KEY: &'static str = "core.event.read";
}

pub struct WorkflowManage;
impl PermissionKey for WorkflowManage {
    const KEY: &'static str = "core.workflow.manage";
}

pub struct ModuleManage;
impl PermissionKey for ModuleManage {
    const KEY: &'static str = "core.module.manage";
}

pub struct IntelligenceManage;
impl PermissionKey for IntelligenceManage {
    const KEY: &'static str = "core.intelligence.manage";
}

pub struct InsightRead;
impl PermissionKey for InsightRead {
    const KEY: &'static str = "core.insight.read";
}
