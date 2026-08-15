use orva_error::{Error, Result};
use uuid::Uuid;

use crate::{
    entity::{Task, TaskStatus},
    pool::{begin_tenant, Pool},
};

pub struct TaskRepository {
    pool: Pool,
}

impl TaskRepository {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    pub async fn create(
        &self,
        organization_id: Uuid,
        title: &str,
        created_by: Option<Uuid>,
    ) -> Result<Task> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let task = sqlx::query_as::<_, Task>(
            "insert into tasks (organization_id, title, created_by) values ($1, $2, $3) returning *",
        )
        .bind(organization_id)
        .bind(title)
        .bind(created_by)
        .fetch_one(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("create task failed: {e}")))?;
        ttx.commit().await?;
        Ok(task)
    }

    pub async fn find_by_id(&self, organization_id: Uuid, id: Uuid) -> Result<Option<Task>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let task = sqlx::query_as::<_, Task>(
            "select * from tasks where organization_id = $1 and id = $2 and deleted_at is null",
        )
        .bind(organization_id)
        .bind(id)
        .fetch_optional(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("find task failed: {e}")))?;
        ttx.commit().await?;
        Ok(task)
    }

    pub async fn list(&self, organization_id: Uuid) -> Result<Vec<Task>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let tasks = sqlx::query_as::<_, Task>(
            "select * from tasks where organization_id = $1 and deleted_at is null order by created_at",
        )
        .bind(organization_id)
        .fetch_all(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("list tasks failed: {e}")))?;
        ttx.commit().await?;
        Ok(tasks)
    }

    pub async fn set_status(
        &self,
        organization_id: Uuid,
        id: Uuid,
        status: TaskStatus,
    ) -> Result<()> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        sqlx::query(
            "update tasks set status = $1, updated_at = now() where organization_id = $2 and id = $3",
        )
        .bind(status.as_str())
        .bind(organization_id)
        .bind(id)
        .execute(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("set task status failed: {e}")))?;
        ttx.commit().await?;
        Ok(())
    }

    pub async fn soft_delete(&self, organization_id: Uuid, id: Uuid) -> Result<()> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        sqlx::query("update tasks set deleted_at = now() where organization_id = $1 and id = $2")
            .bind(organization_id)
            .bind(id)
            .execute(ttx.as_executor())
            .await
            .map_err(|e| Error::Internal(format!("soft delete task failed: {e}")))?;
        ttx.commit().await?;
        Ok(())
    }
}
