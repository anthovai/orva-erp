//! ORVA Core — Workflow Engine (M6)
//!
//! ARCHITECTURE.md §7: `Create → Review → Approve → Execute → Complete` แบบ generic
//! ผูกกับ (resource_type, resource_id) แทนการมี entity เฉพาะทาง เพราะยังไม่มี business
//! module จริง (Finance/HRM ฯลฯ) ในระยะนี้

mod rule;
mod service;
mod status;

pub use orva_data::{ApprovalTask, WorkflowInstance};
pub use rule::{Rule, RuleOperator};
pub use service::WorkflowService;
pub use status::WorkflowStatus;
