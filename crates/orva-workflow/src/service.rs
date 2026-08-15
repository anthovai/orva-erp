use orva_data::{
    ApprovalTask, ApprovalTaskRepository, Pool, WorkflowInstance, WorkflowInstanceRepository,
};
use orva_error::{Error, Result};
use orva_events::{catalog, EventBus, PublishOptions};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::rule::Rule;
use crate::status::{validate_transition, WorkflowStatus};

pub struct WorkflowService {
    instances: WorkflowInstanceRepository,
    tasks: ApprovalTaskRepository,
    events: EventBus,
}

impl WorkflowService {
    pub fn new(pool: Pool, events: EventBus) -> Self {
        Self {
            instances: WorkflowInstanceRepository::new(pool.clone()),
            tasks: ApprovalTaskRepository::new(pool),
            events,
        }
    }

    /// สร้าง workflow instance ผูกกับ resource ใด ๆ (opaque `resource_type`/`resource_id` —
    /// ยังไม่มี business module ที่มี entity จริงอย่าง Invoice จึงรับเป็น generic)
    /// `rule` คือเงื่อนไข approval ตาม ARCHITECTURE.md §7 (optional — ไม่ให้มา = ไม่มีขั้น approval)
    ///
    /// `created_by` เป็น `Option<Uuid>` เพราะ ORVA Agent (M8) ก็สร้าง workflow ได้ — agent
    /// ไม่ใช่ user แถวใน `users` table จึงไม่มี id ให้ผูก FK ได้ (ใส่ `None` ในกรณีนั้น)
    pub async fn create(
        &self,
        organization_id: Uuid,
        resource_type: &str,
        resource_id: Uuid,
        context: Value,
        rule: Option<Rule>,
        created_by: Option<Uuid>,
    ) -> Result<WorkflowInstance> {
        let rule_json = rule
            .map(serde_json::to_value)
            .transpose()
            .map_err(|e| Error::Internal(format!("serialize rule failed: {e}")))?;

        let instance = self
            .instances
            .create(
                organization_id,
                resource_type,
                resource_id,
                context,
                rule_json,
                created_by,
            )
            .await?;

        self.events
            .publish(
                organization_id,
                catalog::WORKFLOW_CREATED,
                json!({ "workflow_instance_id": instance.id }),
                PublishOptions {
                    actor_user_id: created_by,
                    resource: Some((resource_type.to_string(), resource_id)),
                    ..Default::default()
                },
            )
            .await?;

        Ok(instance)
    }

    pub async fn start_review(
        &self,
        organization_id: Uuid,
        instance_id: Uuid,
    ) -> Result<WorkflowInstance> {
        let instance = self.get(organization_id, instance_id).await?;
        validate_transition(instance.status.parse()?, WorkflowStatus::Review)?;
        self.instances
            .set_status(
                organization_id,
                instance_id,
                WorkflowStatus::Review.as_str(),
            )
            .await
    }

    /// ประเมิน rule กับ context ของ instance — ถ้า trigger ต้องส่ง `approver_id` มาด้วย
    /// (สร้าง [`ApprovalTask`] มอบให้) ถ้าไม่ trigger ข้ามไป `Executing` ตรง ๆ
    pub async fn evaluate_and_advance(
        &self,
        organization_id: Uuid,
        instance_id: Uuid,
        approver_id: Option<Uuid>,
    ) -> Result<WorkflowInstance> {
        let instance = self.get(organization_id, instance_id).await?;
        let current: WorkflowStatus = instance.status.parse()?;

        let rule: Option<Rule> = instance
            .rule
            .as_ref()
            .map(|v| serde_json::from_value(v.clone()))
            .transpose()
            .map_err(|e| Error::Internal(format!("invalid stored rule: {e}")))?;
        let needs_approval = rule.as_ref().is_some_and(|r| r.evaluate(&instance.context));

        if needs_approval {
            validate_transition(current, WorkflowStatus::PendingApproval)?;
            let approver_id = approver_id.ok_or_else(|| {
                Error::Validation(
                    "rule triggered approval requirement — approver_id is required".to_string(),
                )
            })?;

            self.tasks
                .create(organization_id, instance_id, approver_id)
                .await?;
            let updated = self
                .instances
                .set_status(
                    organization_id,
                    instance_id,
                    WorkflowStatus::PendingApproval.as_str(),
                )
                .await?;

            self.events
                .publish(
                    organization_id,
                    catalog::WORKFLOW_APPROVAL_REQUESTED,
                    json!({ "workflow_instance_id": instance_id, "assigned_to": approver_id }),
                    PublishOptions {
                        resource: Some((instance.resource_type.clone(), instance.resource_id)),
                        ..Default::default()
                    },
                )
                .await?;

            Ok(updated)
        } else {
            validate_transition(current, WorkflowStatus::Executing)?;
            self.instances
                .set_status(
                    organization_id,
                    instance_id,
                    WorkflowStatus::Executing.as_str(),
                )
                .await
        }
    }

    /// อนุมัติ — เฉพาะ user ที่ถูก assign ไว้เท่านั้นที่ทำได้ (ไม่ใช่ permission กว้าง ๆ
    /// แต่เป็นการเช็คความเป็นเจ้าของ task โดยตรง)
    pub async fn approve(
        &self,
        organization_id: Uuid,
        task_id: Uuid,
        decided_by: Uuid,
    ) -> Result<WorkflowInstance> {
        let task = self.get_task(organization_id, task_id).await?;
        self.ensure_assignee_and_pending(&task, decided_by)?;

        self.tasks
            .decide(organization_id, task_id, decided_by, "approved", None)
            .await?;

        let instance = self.get(organization_id, task.workflow_instance_id).await?;
        validate_transition(instance.status.parse()?, WorkflowStatus::Executing)?;
        let updated = self
            .instances
            .set_status(
                organization_id,
                task.workflow_instance_id,
                WorkflowStatus::Executing.as_str(),
            )
            .await?;

        self.events
            .publish(
                organization_id,
                catalog::WORKFLOW_APPROVED,
                json!({ "workflow_instance_id": task.workflow_instance_id, "approval_task_id": task_id }),
                PublishOptions {
                    actor_user_id: Some(decided_by),
                    resource: Some((instance.resource_type.clone(), instance.resource_id)),
                    ..Default::default()
                },
            )
            .await?;

        Ok(updated)
    }

    pub async fn reject(
        &self,
        organization_id: Uuid,
        task_id: Uuid,
        decided_by: Uuid,
        reason: Option<&str>,
    ) -> Result<WorkflowInstance> {
        let task = self.get_task(organization_id, task_id).await?;
        self.ensure_assignee_and_pending(&task, decided_by)?;

        self.tasks
            .decide(organization_id, task_id, decided_by, "rejected", reason)
            .await?;

        let instance = self.get(organization_id, task.workflow_instance_id).await?;
        validate_transition(instance.status.parse()?, WorkflowStatus::Rejected)?;
        let updated = self
            .instances
            .set_status(
                organization_id,
                task.workflow_instance_id,
                WorkflowStatus::Rejected.as_str(),
            )
            .await?;

        self.events
            .publish(
                organization_id,
                catalog::WORKFLOW_REJECTED,
                json!({ "workflow_instance_id": task.workflow_instance_id, "approval_task_id": task_id, "reason": reason }),
                PublishOptions {
                    actor_user_id: Some(decided_by),
                    resource: Some((instance.resource_type.clone(), instance.resource_id)),
                    ..Default::default()
                },
            )
            .await?;

        Ok(updated)
    }

    pub async fn complete(
        &self,
        organization_id: Uuid,
        instance_id: Uuid,
    ) -> Result<WorkflowInstance> {
        let instance = self.get(organization_id, instance_id).await?;
        validate_transition(instance.status.parse()?, WorkflowStatus::Completed)?;
        let updated = self
            .instances
            .set_status(
                organization_id,
                instance_id,
                WorkflowStatus::Completed.as_str(),
            )
            .await?;

        self.events
            .publish(
                organization_id,
                catalog::WORKFLOW_COMPLETED,
                json!({ "workflow_instance_id": instance_id }),
                PublishOptions {
                    resource: Some((instance.resource_type.clone(), instance.resource_id)),
                    ..Default::default()
                },
            )
            .await?;

        Ok(updated)
    }

    /// งาน approve ที่รอ user คนนี้อยู่ — ใช้กับ `GET /api/v1/approval-tasks/mine`
    pub async fn list_my_pending_tasks(
        &self,
        organization_id: Uuid,
        user_id: Uuid,
    ) -> Result<Vec<ApprovalTask>> {
        self.tasks
            .list_pending_for_user(organization_id, user_id)
            .await
    }

    pub async fn get(&self, organization_id: Uuid, instance_id: Uuid) -> Result<WorkflowInstance> {
        self.instances
            .find_by_id(organization_id, instance_id)
            .await?
            .ok_or_else(|| Error::NotFound(format!("workflow instance '{instance_id}'")))
    }

    async fn get_task(&self, organization_id: Uuid, task_id: Uuid) -> Result<ApprovalTask> {
        self.tasks
            .find_by_id(organization_id, task_id)
            .await?
            .ok_or_else(|| Error::NotFound(format!("approval task '{task_id}'")))
    }

    fn ensure_assignee_and_pending(&self, task: &ApprovalTask, decided_by: Uuid) -> Result<()> {
        if task.assigned_to != decided_by {
            return Err(Error::Forbidden(
                "only the assigned approver may decide this task".to_string(),
            ));
        }
        if task.status != "pending" {
            return Err(Error::Validation(format!(
                "approval task already decided: {}",
                task.status
            )));
        }
        Ok(())
    }
}
