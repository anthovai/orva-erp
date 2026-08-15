use chrono::Utc;
use orva_error::{Error, Result};
use serde_json::Value;
use uuid::Uuid;

use crate::{
    entity::{ApprovalTask, WorkflowInstance},
    pool::Pool,
};

#[derive(Clone)]
pub struct WorkflowInstanceRepository {
    pool: Pool,
}

impl WorkflowInstanceRepository {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    pub async fn create(
        &self,
        organization_id: Uuid,
        resource_type: &str,
        resource_id: Uuid,
        context: Value,
        rule: Option<Value>,
        created_by: Option<Uuid>,
    ) -> Result<WorkflowInstance> {
        sqlx::query_as::<_, WorkflowInstance>(
            "insert into workflow_instances (organization_id, resource_type, resource_id, context, rule, created_by)
             values ($1, $2, $3, $4, $5, $6) returning *",
        )
        .bind(organization_id)
        .bind(resource_type)
        .bind(resource_id)
        .bind(context)
        .bind(rule)
        .bind(created_by)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("create workflow instance failed: {e}")))
    }

    pub async fn find_by_id(
        &self,
        organization_id: Uuid,
        id: Uuid,
    ) -> Result<Option<WorkflowInstance>> {
        sqlx::query_as::<_, WorkflowInstance>(
            "select * from workflow_instances where organization_id = $1 and id = $2",
        )
        .bind(organization_id)
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("find workflow instance failed: {e}")))
    }

    /// อัปเดตสถานะ — การเช็คว่า transition ถูกต้องไหมเป็นหน้าที่ของ `orva-workflow`
    /// (repository นี้แค่เขียนค่าที่ business logic ตัดสินใจแล้วเท่านั้น)
    pub async fn set_status(
        &self,
        organization_id: Uuid,
        id: Uuid,
        status: &str,
    ) -> Result<WorkflowInstance> {
        sqlx::query_as::<_, WorkflowInstance>(
            "update workflow_instances set status = $1, updated_at = now()
             where organization_id = $2 and id = $3 returning *",
        )
        .bind(status)
        .bind(organization_id)
        .bind(id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("update workflow instance status failed: {e}")))
    }
}

#[derive(Clone)]
pub struct ApprovalTaskRepository {
    pool: Pool,
}

impl ApprovalTaskRepository {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    pub async fn create(
        &self,
        organization_id: Uuid,
        workflow_instance_id: Uuid,
        assigned_to: Uuid,
    ) -> Result<ApprovalTask> {
        sqlx::query_as::<_, ApprovalTask>(
            "insert into approval_tasks (organization_id, workflow_instance_id, assigned_to)
             values ($1, $2, $3) returning *",
        )
        .bind(organization_id)
        .bind(workflow_instance_id)
        .bind(assigned_to)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("create approval task failed: {e}")))
    }

    pub async fn find_by_id(
        &self,
        organization_id: Uuid,
        id: Uuid,
    ) -> Result<Option<ApprovalTask>> {
        sqlx::query_as::<_, ApprovalTask>(
            "select * from approval_tasks where organization_id = $1 and id = $2",
        )
        .bind(organization_id)
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("find approval task failed: {e}")))
    }

    /// รายการงานที่รอ user คนนี้อนุมัติ (`status = 'pending'`) — ใช้กับ `GET /api/v1/approval-tasks/mine`
    pub async fn list_pending_for_user(
        &self,
        organization_id: Uuid,
        assigned_to: Uuid,
    ) -> Result<Vec<ApprovalTask>> {
        sqlx::query_as::<_, ApprovalTask>(
            "select * from approval_tasks
             where organization_id = $1 and assigned_to = $2 and status = 'pending'
             order by created_at",
        )
        .bind(organization_id)
        .bind(assigned_to)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("list pending approval tasks failed: {e}")))
    }

    pub async fn decide(
        &self,
        organization_id: Uuid,
        id: Uuid,
        decided_by: Uuid,
        status: &str,
        reason: Option<&str>,
    ) -> Result<ApprovalTask> {
        sqlx::query_as::<_, ApprovalTask>(
            "update approval_tasks
             set status = $1, decided_by = $2, decided_at = $3, reason = $4
             where organization_id = $5 and id = $6 returning *",
        )
        .bind(status)
        .bind(decided_by)
        .bind(Utc::now())
        .bind(reason)
        .bind(organization_id)
        .bind(id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("decide approval task failed: {e}")))
    }
}
