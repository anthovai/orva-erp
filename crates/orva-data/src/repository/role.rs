use orva_error::{Error, Result};
use uuid::Uuid;

use crate::{
    entity::{Permission, Role},
    pool::{begin_tenant, Pool},
};

/// Catalog กลาง — ตาราง `permissions` ไม่มีข้อมูล tenant จึง**ไม่อยู่ใต้ RLS** (ดู ADR 0005)
pub struct PermissionRepository {
    pool: Pool,
}

impl PermissionRepository {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    pub async fn list(&self) -> Result<Vec<Permission>> {
        sqlx::query_as::<_, Permission>("select * from permissions order by key")
            .fetch_all(&self.pool)
            .await
            .map_err(|e| Error::Internal(format!("list permissions failed: {e}")))
    }

    pub async fn find_by_key(&self, key: &str) -> Result<Option<Permission>> {
        sqlx::query_as::<_, Permission>("select * from permissions where key = $1")
            .bind(key)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| Error::Internal(format!("find permission failed: {e}")))
    }

    /// ให้ module ประกาศ permission key ของตัวเองเข้า catalog กลาง (M7) — idempotent,
    /// เรียกซ้ำได้ทุกครั้งที่ module เริ่มทำงาน (upsert ตาม key)
    pub async fn upsert(&self, key: &str, description: &str) -> Result<Permission> {
        sqlx::query_as::<_, Permission>(
            "insert into permissions (key, description) values ($1, $2)
             on conflict (key) do update set description = excluded.description
             returning *",
        )
        .bind(key)
        .bind(description)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("upsert permission failed: {e}")))
    }
}

pub struct RoleRepository {
    pool: Pool,
}

impl RoleRepository {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    pub async fn create(
        &self,
        organization_id: Uuid,
        name: &str,
        created_by: Option<Uuid>,
    ) -> Result<Role> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let role = sqlx::query_as::<_, Role>(
            "insert into roles (organization_id, name, created_by) values ($1, $2, $3) returning *",
        )
        .bind(organization_id)
        .bind(name)
        .bind(created_by)
        .fetch_one(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("create role failed: {e}")))?;
        ttx.commit().await?;
        Ok(role)
    }

    pub async fn find_by_id(&self, organization_id: Uuid, id: Uuid) -> Result<Option<Role>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let role = sqlx::query_as::<_, Role>(
            "select * from roles where organization_id = $1 and id = $2 and deleted_at is null",
        )
        .bind(organization_id)
        .bind(id)
        .fetch_optional(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("find role failed: {e}")))?;
        ttx.commit().await?;
        Ok(role)
    }

    pub async fn list(&self, organization_id: Uuid) -> Result<Vec<Role>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let roles = sqlx::query_as::<_, Role>(
            "select * from roles where organization_id = $1 and deleted_at is null order by created_at",
        )
        .bind(organization_id)
        .fetch_all(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("list roles failed: {e}")))?;
        ttx.commit().await?;
        Ok(roles)
    }

    pub async fn soft_delete(&self, organization_id: Uuid, id: Uuid) -> Result<()> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        sqlx::query("update roles set deleted_at = now() where organization_id = $1 and id = $2")
            .bind(organization_id)
            .bind(id)
            .execute(ttx.as_executor())
            .await
            .map_err(|e| Error::Internal(format!("soft delete role failed: {e}")))?;
        ttx.commit().await?;
        Ok(())
    }

    /// ให้ permission กับ role — permission_id ต้องมีอยู่ใน catalog กลางแล้ว (ดู [`PermissionRepository`])
    /// RLS ของ `role_permissions` scope ผ่าน parent role → ต้องรู้ organization ของ role นั้น
    pub async fn grant_permission(
        &self,
        organization_id: Uuid,
        role_id: Uuid,
        permission_id: Uuid,
    ) -> Result<()> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        sqlx::query(
            "insert into role_permissions (role_id, permission_id) values ($1, $2)
             on conflict (role_id, permission_id) do nothing",
        )
        .bind(role_id)
        .bind(permission_id)
        .execute(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("grant permission failed: {e}")))?;
        ttx.commit().await?;
        Ok(())
    }

    pub async fn assign_to_user(
        &self,
        organization_id: Uuid,
        role_id: Uuid,
        user_id: Uuid,
    ) -> Result<()> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        sqlx::query(
            "insert into user_roles (user_id, role_id, organization_id) values ($1, $2, $3)
             on conflict (user_id, role_id) do nothing",
        )
        .bind(user_id)
        .bind(role_id)
        .bind(organization_id)
        .execute(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("assign role failed: {e}")))?;
        ttx.commit().await?;
        Ok(())
    }

    /// รวม permission key ทั้งหมดที่ user มีในองค์กรนี้ (ผ่านทุก role ที่ถือ) — ใช้โดย `orva_auth`
    pub async fn permission_keys_for_user(
        &self,
        organization_id: Uuid,
        user_id: Uuid,
    ) -> Result<Vec<String>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let keys = sqlx::query_scalar::<_, String>(
            "select distinct p.key
             from user_roles ur
             join roles r on r.id = ur.role_id and r.deleted_at is null
             join role_permissions rp on rp.role_id = r.id
             join permissions p on p.id = rp.permission_id
             where ur.organization_id = $1 and ur.user_id = $2",
        )
        .bind(organization_id)
        .bind(user_id)
        .fetch_all(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("load permissions for user failed: {e}")))?;
        ttx.commit().await?;
        Ok(keys)
    }
}
