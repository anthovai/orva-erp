use orva_error::{Error, Result};
use uuid::Uuid;

use crate::{entity::Organization, pool::Pool};

pub struct OrganizationRepository {
    pool: Pool,
}

impl OrganizationRepository {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    pub async fn create(&self, name: &str, slug: &str) -> Result<Organization> {
        sqlx::query_as::<_, Organization>(
            "insert into organizations (name, slug) values ($1, $2) returning *",
        )
        .bind(name)
        .bind(slug)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("create organization failed: {e}")))
    }

    pub async fn find_by_id(&self, id: Uuid) -> Result<Option<Organization>> {
        sqlx::query_as::<_, Organization>(
            "select * from organizations where id = $1 and deleted_at is null",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("find organization failed: {e}")))
    }

    pub async fn find_by_slug(&self, slug: &str) -> Result<Option<Organization>> {
        sqlx::query_as::<_, Organization>(
            "select * from organizations where slug = $1 and deleted_at is null",
        )
        .bind(slug)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("find organization by slug failed: {e}")))
    }

    pub async fn list(&self) -> Result<Vec<Organization>> {
        sqlx::query_as::<_, Organization>(
            "select * from organizations where deleted_at is null order by created_at",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("list organizations failed: {e}")))
    }

    pub async fn soft_delete(&self, id: Uuid) -> Result<()> {
        sqlx::query("update organizations set deleted_at = now() where id = $1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| Error::Internal(format!("soft delete organization failed: {e}")))?;
        Ok(())
    }
}
