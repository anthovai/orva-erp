use orva_error::{Error, Result};
use uuid::Uuid;

use crate::{
    entity::ModuleInstallation,
    pool::{begin_tenant, Pool},
};

#[derive(Clone)]
pub struct ModuleInstallationRepository {
    pool: Pool,
}

impl ModuleInstallationRepository {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    pub async fn install(
        &self,
        organization_id: Uuid,
        module_name: &str,
        version: &str,
        installed_by: Uuid,
    ) -> Result<ModuleInstallation> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let installation = sqlx::query_as::<_, ModuleInstallation>(
            "insert into module_installations (organization_id, module_name, version, installed_by)
             values ($1, $2, $3, $4)
             on conflict (organization_id, module_name)
             do update set version = excluded.version, enabled = true
             returning *",
        )
        .bind(organization_id)
        .bind(module_name)
        .bind(version)
        .bind(installed_by)
        .fetch_one(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("install module failed: {e}")))?;
        ttx.commit().await?;
        Ok(installation)
    }

    pub async fn find(
        &self,
        organization_id: Uuid,
        module_name: &str,
    ) -> Result<Option<ModuleInstallation>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let installation = sqlx::query_as::<_, ModuleInstallation>(
            "select * from module_installations where organization_id = $1 and module_name = $2",
        )
        .bind(organization_id)
        .bind(module_name)
        .fetch_optional(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("find module installation failed: {e}")))?;
        ttx.commit().await?;
        Ok(installation)
    }

    pub async fn list(&self, organization_id: Uuid) -> Result<Vec<ModuleInstallation>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let installations = sqlx::query_as::<_, ModuleInstallation>(
            "select * from module_installations where organization_id = $1 order by installed_at",
        )
        .bind(organization_id)
        .fetch_all(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("list module installations failed: {e}")))?;
        ttx.commit().await?;
        Ok(installations)
    }

    pub async fn set_enabled(
        &self,
        organization_id: Uuid,
        module_name: &str,
        enabled: bool,
    ) -> Result<()> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        sqlx::query(
            "update module_installations set enabled = $1
             where organization_id = $2 and module_name = $3",
        )
        .bind(enabled)
        .bind(organization_id)
        .bind(module_name)
        .execute(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("set module enabled failed: {e}")))?;
        ttx.commit().await?;
        Ok(())
    }

    /// ใช้โดย middleware ของ module เองเพื่อเช็คว่า install แล้ว + enabled ก่อนให้เข้าถึง route
    pub async fn is_enabled(&self, organization_id: Uuid, module_name: &str) -> Result<bool> {
        Ok(self
            .find(organization_id, module_name)
            .await?
            .is_some_and(|m| m.enabled))
    }
}
