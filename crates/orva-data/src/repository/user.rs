use orva_error::{Error, Result};
use uuid::Uuid;

use crate::{
    entity::User,
    pool::{begin_tenant, Pool},
};

pub struct UserRepository {
    pool: Pool,
}

impl UserRepository {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    pub async fn create(
        &self,
        organization_id: Uuid,
        email: &str,
        display_name: &str,
        password_hash: &str,
        created_by: Option<Uuid>,
    ) -> Result<User> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let user = sqlx::query_as::<_, User>(
            "insert into users (organization_id, email, display_name, password_hash, created_by)
             values ($1, $2, $3, $4, $5) returning *",
        )
        .bind(organization_id)
        .bind(email)
        .bind(display_name)
        .bind(password_hash)
        .bind(created_by)
        .fetch_one(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("create user failed: {e}")))?;
        ttx.commit().await?;
        Ok(user)
    }

    pub async fn find_by_id(&self, organization_id: Uuid, id: Uuid) -> Result<Option<User>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let user = sqlx::query_as::<_, User>(
            "select * from users where organization_id = $1 and id = $2 and deleted_at is null",
        )
        .bind(organization_id)
        .bind(id)
        .fetch_optional(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("find user failed: {e}")))?;
        ttx.commit().await?;
        Ok(user)
    }

    pub async fn list(&self, organization_id: Uuid) -> Result<Vec<User>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let users = sqlx::query_as::<_, User>(
            "select * from users where organization_id = $1 and deleted_at is null order by created_at",
        )
        .bind(organization_id)
        .fetch_all(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("list users failed: {e}")))?;
        ttx.commit().await?;
        Ok(users)
    }

    /// เก็บ secret ที่เพิ่ง setup (สถานะ pending — `mfa_enabled` ยังเป็น false จนกว่า
    /// user จะยืนยัน code แรกผ่าน activate)
    pub async fn set_mfa_secret(
        &self,
        organization_id: Uuid,
        id: Uuid,
        secret: &str,
    ) -> Result<()> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        sqlx::query(
            "update users set mfa_secret = $1, mfa_enabled = false, updated_at = now()
             where organization_id = $2 and id = $3",
        )
        .bind(secret)
        .bind(organization_id)
        .bind(id)
        .execute(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("set mfa secret failed: {e}")))?;
        ttx.commit().await?;
        Ok(())
    }

    pub async fn set_mfa_enabled(
        &self,
        organization_id: Uuid,
        id: Uuid,
        enabled: bool,
    ) -> Result<()> {
        // ปิด MFA = ล้าง secret ทิ้งด้วย — เปิดใหม่ต้อง setup secret ใหม่เสมอ
        let sql = if enabled {
            "update users set mfa_enabled = true, updated_at = now()
             where organization_id = $1 and id = $2"
        } else {
            "update users set mfa_enabled = false, mfa_secret = null, updated_at = now()
             where organization_id = $1 and id = $2"
        };
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        sqlx::query(sql)
            .bind(organization_id)
            .bind(id)
            .execute(ttx.as_executor())
            .await
            .map_err(|e| Error::Internal(format!("set mfa enabled failed: {e}")))?;
        ttx.commit().await?;
        Ok(())
    }

    pub async fn soft_delete(&self, organization_id: Uuid, id: Uuid) -> Result<()> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        sqlx::query("update users set deleted_at = now() where organization_id = $1 and id = $2")
            .bind(organization_id)
            .bind(id)
            .execute(ttx.as_executor())
            .await
            .map_err(|e| Error::Internal(format!("soft delete user failed: {e}")))?;
        ttx.commit().await?;
        Ok(())
    }
}
