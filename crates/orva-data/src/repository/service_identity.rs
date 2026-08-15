use orva_error::{Error, Result};
use uuid::Uuid;

use crate::{entity::ServiceIdentity, pool::Pool};

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
        sqlx::query_as::<_, ServiceIdentity>(
            "insert into service_identities (organization_id, name, key_hash, created_by)
             values ($1, $2, $3, $4) returning *",
        )
        .bind(organization_id)
        .bind(name)
        .bind(key_hash)
        .bind(created_by)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("create service identity failed: {e}")))
    }

    pub async fn find_by_key_hash(&self, key_hash: &str) -> Result<Option<ServiceIdentity>> {
        sqlx::query_as::<_, ServiceIdentity>("select * from service_identities where key_hash = $1")
            .bind(key_hash)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| Error::Internal(format!("find service identity failed: {e}")))
    }

    pub async fn list(&self, organization_id: Uuid) -> Result<Vec<ServiceIdentity>> {
        sqlx::query_as::<_, ServiceIdentity>(
            "select * from service_identities where organization_id = $1 order by created_at",
        )
        .bind(organization_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("list service identities failed: {e}")))
    }

    pub async fn revoke(&self, id: Uuid) -> Result<()> {
        sqlx::query("update service_identities set revoked_at = now() where id = $1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| Error::Internal(format!("revoke service identity failed: {e}")))?;
        Ok(())
    }
}
