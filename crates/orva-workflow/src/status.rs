use orva_error::{Error, Result};

/// State machine ตาม ARCHITECTURE.md §7: `Create → Review → Approve → Execute → Complete`
///
/// "Approve" ไม่ใช่ status ที่ persist แยก — คือช่วง `PendingApproval` (มี [`crate::ApprovalTask`]
/// รออยู่) ที่จบด้วยการข้ามไป `Executing` ตรง ๆ ทันทีที่ approve สำเร็จ
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkflowStatus {
    Created,
    Review,
    PendingApproval,
    Executing,
    Completed,
    Rejected,
}

impl WorkflowStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            WorkflowStatus::Created => "created",
            WorkflowStatus::Review => "review",
            WorkflowStatus::PendingApproval => "pending_approval",
            WorkflowStatus::Executing => "executing",
            WorkflowStatus::Completed => "completed",
            WorkflowStatus::Rejected => "rejected",
        }
    }
}

impl std::str::FromStr for WorkflowStatus {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self> {
        match s {
            "created" => Ok(WorkflowStatus::Created),
            "review" => Ok(WorkflowStatus::Review),
            "pending_approval" => Ok(WorkflowStatus::PendingApproval),
            "executing" => Ok(WorkflowStatus::Executing),
            "completed" => Ok(WorkflowStatus::Completed),
            "rejected" => Ok(WorkflowStatus::Rejected),
            other => Err(Error::Internal(format!("unknown workflow status: {other}"))),
        }
    }
}

/// เช็คว่า transition `from -> to` ถูกต้องตาม state machine ไหม (DoD M6: "state machine +
/// transition validation") ไม่ผ่าน = `Error::Validation` ไม่ใช่แค่เขียนทับเงียบ ๆ
pub fn validate_transition(from: WorkflowStatus, to: WorkflowStatus) -> Result<()> {
    use WorkflowStatus::*;

    let allowed = matches!(
        (from, to),
        (Created, Review)
            | (Review, PendingApproval)
            | (Review, Executing)
            | (PendingApproval, Executing)
            | (PendingApproval, Rejected)
            | (Executing, Completed)
    );

    if allowed {
        Ok(())
    } else {
        Err(Error::Validation(format!(
            "invalid workflow transition: {} -> {}",
            from.as_str(),
            to.as_str()
        )))
    }
}
