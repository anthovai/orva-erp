use orva_error::{Error, Result};
use sqlx::PgPool;

pub type Pool = PgPool;

pub async fn connect(database_url: &str) -> Result<Pool> {
    PgPool::connect(database_url)
        .await
        .map_err(|e| Error::Internal(format!("database connect failed: {e}")))
}

/// รัน migrations ทั้งหมดใน `migrations/` — embed ตอน compile time
pub async fn migrate(pool: &Pool) -> Result<()> {
    sqlx::migrate!("./migrations")
        .run(pool)
        .await
        .map_err(|e| Error::Internal(format!("migration failed: {e}")))
}
