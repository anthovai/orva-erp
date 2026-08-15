use orva_error::{Error, Result};
use uuid::Uuid;

use crate::{
    entity::Document,
    pool::{begin_tenant, Pool},
};

pub struct DocumentRepository {
    pool: Pool,
}

impl DocumentRepository {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    pub async fn create(
        &self,
        organization_id: Uuid,
        title: &str,
        content: &str,
        created_by: Option<Uuid>,
    ) -> Result<Document> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let doc = sqlx::query_as::<_, Document>(
            "insert into documents (organization_id, title, content, created_by)
             values ($1, $2, $3, $4) returning *",
        )
        .bind(organization_id)
        .bind(title)
        .bind(content)
        .bind(created_by)
        .fetch_one(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("create document failed: {e}")))?;
        ttx.commit().await?;
        Ok(doc)
    }

    pub async fn find_by_id(&self, organization_id: Uuid, id: Uuid) -> Result<Option<Document>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let doc = sqlx::query_as::<_, Document>(
            "select * from documents where organization_id = $1 and id = $2 and deleted_at is null",
        )
        .bind(organization_id)
        .bind(id)
        .fetch_optional(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("find document failed: {e}")))?;
        ttx.commit().await?;
        Ok(doc)
    }

    pub async fn list(&self, organization_id: Uuid) -> Result<Vec<Document>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let docs = sqlx::query_as::<_, Document>(
            "select * from documents where organization_id = $1 and deleted_at is null order by created_at",
        )
        .bind(organization_id)
        .fetch_all(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("list documents failed: {e}")))?;
        ttx.commit().await?;
        Ok(docs)
    }

    pub async fn soft_delete(&self, organization_id: Uuid, id: Uuid) -> Result<()> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        sqlx::query(
            "update documents set deleted_at = now() where organization_id = $1 and id = $2",
        )
        .bind(organization_id)
        .bind(id)
        .execute(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("soft delete document failed: {e}")))?;
        ttx.commit().await?;
        Ok(())
    }
}
