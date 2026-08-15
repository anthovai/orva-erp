use chrono::{DateTime, Utc};
use orva_error::{Error, Result};
use uuid::Uuid;

use crate::{entity::Session, pool::Pool};

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
        sqlx::query_as::<_, Session>(
            "insert into sessions (organization_id, user_id, token_hash, expires_at)
             values ($1, $2, $3, $4) returning *",
        )
        .bind(organization_id)
        .bind(user_id)
        .bind(token_hash)
        .bind(expires_at)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("create session failed: {e}")))
    }

    pub async fn find_by_token_hash(&self, token_hash: &str) -> Result<Option<Session>> {
        sqlx::query_as::<_, Session>("select * from sessions where token_hash = $1")
            .bind(token_hash)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| Error::Internal(format!("find session failed: {e}")))
    }

    pub async fn revoke(&self, id: Uuid) -> Result<()> {
        sqlx::query("update sessions set revoked_at = now() where id = $1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| Error::Internal(format!("revoke session failed: {e}")))?;
        Ok(())
    }
}
