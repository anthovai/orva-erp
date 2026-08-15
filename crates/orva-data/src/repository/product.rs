use orva_error::{Error, Result};
use uuid::Uuid;

use crate::{
    entity::Product,
    pool::{begin_tenant, Pool},
};

pub struct ProductFields<'a> {
    pub name: &'a str,
    pub sku: &'a str,
    pub description: &'a str,
    pub is_active: bool,
}

#[derive(Clone)]
pub struct ProductRepository {
    pool: Pool,
}

impl ProductRepository {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    /// projection upsert — idempotent ตาม (organization, source_module, source_id)
    pub async fn upsert_from_source(
        &self,
        organization_id: Uuid,
        source_module: &str,
        source_id: &str,
        fields: ProductFields<'_>,
    ) -> Result<Product> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let product = sqlx::query_as::<_, Product>(
            "insert into products
                (organization_id, source_module, source_id, name, sku, description, is_active)
             values ($1, $2, $3, $4, $5, $6, $7)
             on conflict (organization_id, source_module, source_id)
             do update set name = excluded.name, sku = excluded.sku,
                           description = excluded.description, is_active = excluded.is_active,
                           deleted_at = null, updated_at = now()
             returning *",
        )
        .bind(organization_id)
        .bind(source_module)
        .bind(source_id)
        .bind(fields.name)
        .bind(fields.sku)
        .bind(fields.description)
        .bind(fields.is_active)
        .fetch_one(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("upsert product failed: {e}")))?;
        ttx.commit().await?;
        Ok(product)
    }

    pub async fn soft_delete_from_source(
        &self,
        organization_id: Uuid,
        source_module: &str,
        source_id: &str,
    ) -> Result<()> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        sqlx::query(
            "update products set deleted_at = now(), updated_at = now()
             where organization_id = $1 and source_module = $2 and source_id = $3",
        )
        .bind(organization_id)
        .bind(source_module)
        .bind(source_id)
        .execute(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("soft delete product failed: {e}")))?;
        ttx.commit().await?;
        Ok(())
    }

    pub async fn list(&self, organization_id: Uuid) -> Result<Vec<Product>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let products = sqlx::query_as::<_, Product>(
            "select * from products where organization_id = $1 and deleted_at is null
             order by created_at",
        )
        .bind(organization_id)
        .fetch_all(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("list products failed: {e}")))?;
        ttx.commit().await?;
        Ok(products)
    }
}
