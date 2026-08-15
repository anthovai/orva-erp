use orva_error::{Error, Result};
use uuid::Uuid;

use crate::{
    entity::ServiceIdentity,
    pool::{begin_rls_bypass, begin_tenant, Pool},
};

pub struct ServiceIdentityRepository {
    pool: Pool,
}

impl ServiceIdentityRepository {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    pub async fn create(
        &self,
        organization_id: Uuid,
        name: &str,
        key_hash: &str,
        created_by: Option<Uuid>,
    ) -> Result<ServiceIdentity> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let identity = sqlx::query_as::<_, ServiceIdentity>(
            "insert into service_identities (organization_id, name, key_hash, created_by)
             values ($1, $2, $3, $4) returning *",
        )
        .bind(organization_id)
        .bind(name)
        .bind(key_hash)
        .bind(created_by)
        .fetch_one(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("create service identity failed: {e}")))?;
        ttx.commit().await?;
        Ok(identity)
    }

    /// Bootstrap lookup — ยังไม่รู้ organization จนกว่าจะเจอ identity จึงต้องข้าม RLS
    /// (key hash เป็นคีย์สุ่ม 256-bit — unique ทั้งระบบอยู่แล้ว ดู ADR 0005)
    pub async fn find_by_key_hash(&self, key_hash: &str) -> Result<Option<ServiceIdentity>> {
        let mut ttx = begin_rls_bypass(&self.pool).await?;
        let identity = sqlx::query_as::<_, ServiceIdentity>(
            "select * from service_identities where key_hash = $1",
        )
        .bind(key_hash)
        .fetch_optional(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("find service identity failed: {e}")))?;
        ttx.commit().await?;
        Ok(identity)
    }

    pub async fn list(&self, organization_id: Uuid) -> Result<Vec<ServiceIdentity>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let identities = sqlx::query_as::<_, ServiceIdentity>(
            "select * from service_identities where organization_id = $1 order by created_at",
        )
        .bind(organization_id)
        .fetch_all(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("list service identities failed: {e}")))?;
        ttx.commit().await?;
        Ok(identities)
    }

    pub async fn revoke(&self, organization_id: Uuid, id: Uuid) -> Result<()> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        sqlx::query(
            "update service_identities set revoked_at = now() where organization_id = $1 and id = $2",
        )
        .bind(organization_id)
        .bind(id)
        .execute(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("revoke service identity failed: {e}")))?;
        ttx.commit().await?;
        Ok(())
    }
}
