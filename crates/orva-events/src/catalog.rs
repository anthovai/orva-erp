//! Event catalog ชุดแรกของ ORVA Core (MILESTONES.md M5)
//!
//! ตั้งชื่อแบบ `<resource>.<past-tense-action>` ต่างจาก permission key
//! (`<module>.<resource>.<action>`) เพราะ event คือ "สิ่งที่เกิดขึ้นแล้ว" ไม่ใช่ "สิทธิ์ทำอะไร"

pub const ORGANIZATION_PROVISIONED: &str = "organization.provisioned";
pub const ORGANIZATION_SUSPENDED: &str = "organization.suspended";
pub const ORGANIZATION_RATE_LIMIT_CHANGED: &str = "organization.rate_limit_changed";
pub const USER_REGISTERED: &str = "user.registered";
pub const USER_MFA_ENABLED: &str = "user.mfa_enabled";
pub const USER_MFA_DISABLED: &str = "user.mfa_disabled";
pub const SERVICE_IDENTITY_ISSUED: &str = "service_identity.issued";
pub const ROLE_CREATED: &str = "role.created";
pub const ROLE_ASSIGNED: &str = "role.assigned";

// Workflow Engine (M6) — ARCHITECTURE.md §7
pub const WORKFLOW_CREATED: &str = "workflow.created";
pub const WORKFLOW_APPROVAL_REQUESTED: &str = "workflow.approval_requested";
pub const WORKFLOW_APPROVED: &str = "workflow.approved";
pub const WORKFLOW_REJECTED: &str = "workflow.rejected";
pub const WORKFLOW_COMPLETED: &str = "workflow.completed";

// Intelligence (M8 + ADR 0010)
pub const RECOMMENDATION_CREATED: &str = "recommendation.created";
pub const RECOMMENDATION_ACCEPTED: &str = "recommendation.accepted";
pub const RECOMMENDATION_DISMISSED: &str = "recommendation.dismissed";
/// ADR 0018 — AI analyst วิเคราะห์ context เสร็จ (อาจสร้าง recommendation แนบมาด้วย)
pub const AI_ANALYSIS_COMPLETED: &str = "intelligence.analysis.completed";
