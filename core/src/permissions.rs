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

/// ADR 0016 — อ่าน canonical Employee ขององค์กร
pub struct EmployeeRead;
impl PermissionKey for EmployeeRead {
    const KEY: &'static str = "core.employee.read";
}

/// ADR 0016 — อ่าน canonical Product ขององค์กร
pub struct ProductRead;
impl PermissionKey for ProductRead {
    const KEY: &'static str = "core.product.read";
}

/// ADR 0017 — ORVA Knowledge
pub struct KnowledgeRead;
impl PermissionKey for KnowledgeRead {
    const KEY: &'static str = "core.knowledge.read";
}

pub struct KnowledgeManage;
impl PermissionKey for KnowledgeManage {
    const KEY: &'static str = "core.knowledge.manage";
}

/// ADR 0019 — คิวงานที่มอบให้ ORVA Worker
pub struct WorkerRead;
impl PermissionKey for WorkerRead {
    const KEY: &'static str = "core.worker.read";
}

pub struct WorkerManage;
impl PermissionKey for WorkerManage {
    const KEY: &'static str = "core.worker.manage";
}
