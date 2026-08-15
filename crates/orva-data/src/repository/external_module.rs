use orva_error::{Error, Result};
use uuid::Uuid;

use crate::{
    entity::ExternalModule,
    pool::{begin_tenant, Pool},
};

#[derive(Clone)]
pub struct ExternalModuleRepository {
    pool: Pool,
}

impl ExternalModuleRepository {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    pub async fn register(
        &self,
        organization_id: Uuid,
        name: &str,
        base_url: &str,
        created_by: Option<Uuid>,
    ) -> Result<ExternalModule> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let module = sqlx::query_as::<_, ExternalModule>(
            "insert into external_modules (organization_id, name, base_url, created_by)
             values ($1, $2, $3, $4)
             on conflict (organization_id, name)
             do update set base_url = excluded.base_url, enabled = true, updated_at = now()
             returning *",
        )
        .bind(organization_id)
        .bind(name)
        .bind(base_url)
        .bind(created_by)
        .fetch_one(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("register external module failed: {e}")))?;
        ttx.commit().await?;
        Ok(module)
    }

    pub async fn find_by_name(
        &self,
        organization_id: Uuid,
        name: &str,
    ) -> Result<Option<ExternalModule>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let module = sqlx::query_as::<_, ExternalModule>(
            "select * from external_modules where organization_id = $1 and name = $2",
        )
        .bind(organization_id)
        .bind(name)
        .fetch_optional(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("find external module failed: {e}")))?;
        ttx.commit().await?;
        Ok(module)
    }

    pub async fn list(&self, organization_id: Uuid) -> Result<Vec<ExternalModule>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let modules = sqlx::query_as::<_, ExternalModule>(
            "select * from external_modules where organization_id = $1 order by created_at",
        )
        .bind(organization_id)
        .fetch_all(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("list external modules failed: {e}")))?;
        ttx.commit().await?;
        Ok(modules)
    }

    pub async fn set_enabled(
        &self,
        organization_id: Uuid,
        name: &str,
        enabled: bool,
    ) -> Result<()> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        sqlx::query(
            "update external_modules set enabled = $1, updated_at = now()
             where organization_id = $2 and name = $3",
        )
        .bind(enabled)
        .bind(organization_id)
        .bind(name)
        .execute(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("set external module enabled failed: {e}")))?;
        ttx.commit().await?;
        Ok(())
    }
}
