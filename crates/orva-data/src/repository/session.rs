use chrono::{DateTime, Utc};
use orva_error::{Error, Result};
use uuid::Uuid;

use crate::{
    entity::Session,
    pool::{begin_rls_bypass, begin_tenant, Pool},
};

pub struct SessionRepository {
    pool: Pool,
}

impl SessionRepository {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    pub async fn create(
        &self,
        organization_id: Uuid,
        user_id: Uuid,
        token_hash: &str,
        expires_at: DateTime<Utc>,
    ) -> Result<Session> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let session = sqlx::query_as::<_, Session>(
            "insert into sessions (organization_id, user_id, token_hash, expires_at)
             values ($1, $2, $3, $4) returning *",
        )
        .bind(organization_id)
        .bind(user_id)
        .bind(token_hash)
        .bind(expires_at)
        .fetch_one(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("create session failed: {e}")))?;
        ttx.commit().await?;
        Ok(session)
    }

    /// Bootstrap lookup — ยังไม่รู้ organization จนกว่าจะเจอ session จึงต้องข้าม RLS
    /// (token hash เป็นคีย์สุ่ม 256-bit — unique ทั้งระบบอยู่แล้ว ดู ADR 0005)
    pub async fn find_by_token_hash(&self, token_hash: &str) -> Result<Option<Session>> {
        let mut ttx = begin_rls_bypass(&self.pool).await?;
        let session = sqlx::query_as::<_, Session>("select * from sessions where token_hash = $1")
            .bind(token_hash)
            .fetch_optional(ttx.as_executor())
            .await
            .map_err(|e| Error::Internal(format!("find session failed: {e}")))?;
        ttx.commit().await?;
        Ok(session)
    }

    pub async fn revoke(&self, organization_id: Uuid, id: Uuid) -> Result<()> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        sqlx::query(
            "update sessions set revoked_at = now() where organization_id = $1 and id = $2",
        )
        .bind(organization_id)
        .bind(id)
        .execute(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("revoke session failed: {e}")))?;
        ttx.commit().await?;
        Ok(())
    }
}
