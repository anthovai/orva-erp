use orva_error::{Error, Result};
use uuid::Uuid;

use crate::{
    entity::WorkerTask,
    pool::{begin_tenant, Pool},
};

#[derive(Clone)]
pub struct WorkerTaskRepository {
    pool: Pool,
}

pub struct CreateWorkerTaskParams<'a> {
    pub instruction: &'a str,
    /// `manual` | `recommendation` | `workflow`
    pub source: &'a str,
    pub source_id: Option<Uuid>,
    pub created_by: Option<Uuid>,
}

impl WorkerTaskRepository {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    pub async fn create(
        &self,
        organization_id: Uuid,
        params: CreateWorkerTaskParams<'_>,
    ) -> Result<WorkerTask> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let task = sqlx::query_as::<_, WorkerTask>(
            "insert into worker_tasks
                (organization_id, instruction, source, source_id, created_by)
             values ($1, $2, $3, $4, $5) returning *",
        )
        .bind(organization_id)
        .bind(params.instruction)
        .bind(params.source)
        .bind(params.source_id)
        .bind(params.created_by)
        .fetch_one(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("create worker task failed: {e}")))?;
        ttx.commit().await?;
        Ok(task)
    }

    /// `status` = `None` คือทุกสถานะ — ล่าสุดก่อน
    pub async fn list(
        &self,
        organization_id: Uuid,
        status: Option<&str>,
        limit: i64,
    ) -> Result<Vec<WorkerTask>> {
        let sql = match status {
            Some(_) => {
                "select * from worker_tasks
                 where organization_id = $1 and status = $2
                 order by created_at desc limit $3"
            }
            None => {
                "select * from worker_tasks
                 where organization_id = $1 and ($2::text is null or true)
                 order by created_at desc limit $3"
            }
        };
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let tasks = sqlx::query_as::<_, WorkerTask>(sql)
            .bind(organization_id)
            .bind(status)
            .bind(limit)
            .fetch_all(ttx.as_executor())
            .await
            .map_err(|e| Error::Internal(format!("list worker tasks failed: {e}")))?;
        ttx.commit().await?;
        Ok(tasks)
    }

    /// คิวที่ worker มา poll — เก่าก่อน (FIFO) เพราะเป็นคิวงานจริง
    pub async fn list_pending(&self, organization_id: Uuid, limit: i64) -> Result<Vec<WorkerTask>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let tasks = sqlx::query_as::<_, WorkerTask>(
            "select * from worker_tasks
             where organization_id = $1 and status = 'pending'
             order by created_at limit $2",
        )
        .bind(organization_id)
        .bind(limit)
        .fetch_all(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("list pending worker tasks failed: {e}")))?;
        ttx.commit().await?;
        Ok(tasks)
    }

    pub async fn find_by_id(&self, organization_id: Uuid, id: Uuid) -> Result<Option<WorkerTask>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let task = sqlx::query_as::<_, WorkerTask>(
            "select * from worker_tasks where organization_id = $1 and id = $2",
        )
        .bind(organization_id)
        .bind(id)
        .fetch_optional(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("find worker task failed: {e}")))?;
        ttx.commit().await?;
        Ok(task)
    }

    /// claim แบบ atomic — conditional update บน `status = 'pending'` ทำให้ worker
    /// หลายตัว poll คิวเดียวกันพร้อมกันได้โดยงานหนึ่งชิ้นตกเป็นของตัวเดียวเท่านั้น
    /// (คืน `None` = มีคนอื่นคว้าไปแล้ว)
    pub async fn claim(
        &self,
        organization_id: Uuid,
        id: Uuid,
        claimed_by: Uuid,
    ) -> Result<Option<WorkerTask>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let task = sqlx::query_as::<_, WorkerTask>(
            "update worker_tasks
             set status = 'running', claimed_by = $1, claimed_at = now(), updated_at = now()
             where organization_id = $2 and id = $3 and status = 'pending'
             returning *",
        )
        .bind(claimed_by)
        .bind(organization_id)
        .bind(id)
        .fetch_optional(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("claim worker task failed: {e}")))?;
        ttx.commit().await?;
        Ok(task)
    }

    /// รายงานผล — ทำได้เฉพาะงานที่กำลัง `running` (คืน `None` ถ้าไม่ใช่)
    pub async fn complete(
        &self,
        organization_id: Uuid,
        id: Uuid,
        succeeded: bool,
        result: Option<&str>,
        error: Option<&str>,
    ) -> Result<Option<WorkerTask>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let task = sqlx::query_as::<_, WorkerTask>(
            "update worker_tasks
             set status = $1, result = $2, error = $3, completed_at = now(), updated_at = now()
             where organization_id = $4 and id = $5 and status = 'running'
             returning *",
        )
        .bind(if succeeded { "succeeded" } else { "failed" })
        .bind(result)
        .bind(error)
        .bind(organization_id)
        .bind(id)
        .fetch_optional(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("complete worker task failed: {e}")))?;
        ttx.commit().await?;
        Ok(task)
    }

    /// ยกเลิกได้เฉพาะงานที่ยังไม่ถูก claim — งานที่ worker ลงมือแล้วต้องปล่อยให้จบ
    pub async fn cancel(&self, organization_id: Uuid, id: Uuid) -> Result<Option<WorkerTask>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let task = sqlx::query_as::<_, WorkerTask>(
            "update worker_tasks
             set status = 'cancelled', updated_at = now()
             where organization_id = $1 and id = $2 and status = 'pending'
             returning *",
        )
        .bind(organization_id)
        .bind(id)
        .fetch_optional(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("cancel worker task failed: {e}")))?;
        ttx.commit().await?;
        Ok(task)
    }
}
