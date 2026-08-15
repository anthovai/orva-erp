//! ORVA Core — Data Layer (M1) + Identity (M2) + Authorization (M3) + Event Bus (M5)
//! + Workflow/Notification schema (M6)
//!
//! Canonical entities (ARCHITECTURE.md §8): `User`, `Organization`, `Document`, `Task`
//! implement เต็มแล้ว ที่เหลือ (`Employee`, `Customer`, ...) นิยามไว้ใน [`canonical`]
//! เป็น placeholder ให้ business module ในอนาคตอ้างอิงชื่อเดียวกัน
//!
//! `Team`/`Session`/`ServiceIdentity`/`Role`/`Permission`/`Event`/`WorkflowInstance`/
//! `ApprovalTask`/`Notification` เป็น infra entity ของ Core เอง ไม่ใช่ canonical business
//! entity — business logic อยู่ใน `orva-auth`/`orva-events`/`orva-workflow`/`orva-notifications`

pub mod canonical;
mod entity;
mod pool;
mod repository;

pub use entity::{
    ApprovalTask, Document, Event, Insight, IntelligenceRule, ModuleInstallation, Notification,
    NotificationPreference, Organization, Permission, Role, ServiceIdentity, Session, Task,
    TaskStatus, Team, TeamMember, User, WorkflowInstance,
};
pub use pool::{begin_rls_bypass, begin_tenant, connect, migrate, Pool, TenantTx};
pub use repository::{
    AppendOptions, ApprovalTaskRepository, CreateInsightParams, CreateRuleParams,
    DocumentRepository, EventFilter, EventRepository, InsightRepository,
    IntelligenceRuleRepository, ModuleInstallationRepository, NotificationPreferenceRepository,
    NotificationRepository, OrganizationRepository, PermissionRepository, RoleRepository,
    ServiceIdentityRepository, SessionRepository, TaskRepository, TeamRepository, UserRepository,
    WorkflowInstanceRepository,
};
