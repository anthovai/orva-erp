use orva_error::{Error, Result};
use uuid::Uuid;

use crate::{
    entity::Employee,
    pool::{begin_tenant, Pool},
};

/// field ที่ sync มาจาก external module — รวมเป็น struct (pattern เดียวกับ params อื่น)
pub struct EmployeeFields<'a> {
    pub email: &'a str,
    pub first_name: &'a str,
    pub last_name: &'a str,
    pub is_active: bool,
}

#[derive(Clone)]
pub struct EmployeeRepository {
    pool: Pool,
}

impl EmployeeRepository {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    /// projection upsert — key คือ (organization, source_module, source_id)
    /// event ซ้ำ/มาช้า = idempotent (เขียนทับด้วยค่าล่าสุด + ปลุกแถวที่เคย soft delete)
    pub async fn upsert_from_source(
        &self,
        organization_id: Uuid,
        source_module: &str,
        source_id: &str,
        fields: EmployeeFields<'_>,
    ) -> Result<Employee> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let employee = sqlx::query_as::<_, Employee>(
            "insert into employees
                (organization_id, source_module, source_id, email, first_name, last_name, is_active)
             values ($1, $2, $3, $4, $5, $6, $7)
             on conflict (organization_id, source_module, source_id)
             do update set email = excluded.email, first_name = excluded.first_name,
                           last_name = excluded.last_name, is_active = excluded.is_active,
                           deleted_at = null, updated_at = now()
             returning *",
        )
        .bind(organization_id)
        .bind(source_module)
        .bind(source_id)
        .bind(fields.email)
        .bind(fields.first_name)
        .bind(fields.last_name)
        .bind(fields.is_active)
        .fetch_one(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("upsert employee failed: {e}")))?;
        ttx.commit().await?;
        Ok(employee)
    }

    pub async fn soft_delete_from_source(
        &self,
        organization_id: Uuid,
        source_module: &str,
        source_id: &str,
    ) -> Result<()> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        sqlx::query(
            "update employees set deleted_at = now(), updated_at = now()
             where organization_id = $1 and source_module = $2 and source_id = $3",
        )
        .bind(organization_id)
        .bind(source_module)
        .bind(source_id)
        .execute(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("soft delete employee failed: {e}")))?;
        ttx.commit().await?;
        Ok(())
    }

    pub async fn list(&self, organization_id: Uuid) -> Result<Vec<Employee>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let employees = sqlx::query_as::<_, Employee>(
            "select * from employees where organization_id = $1 and deleted_at is null
             order by created_at",
        )
        .bind(organization_id)
        .fetch_all(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("list employees failed: {e}")))?;
        ttx.commit().await?;
        Ok(employees)
    }
}
