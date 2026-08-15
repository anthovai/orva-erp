use orva_error::{Error, Result};
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

pub type Pool = sqlx::PgPool;

pub async fn connect(database_url: &str) -> Result<Pool> {
    sqlx::PgPool::connect(database_url)
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

/// Transaction ที่ตั้ง GUC (`app.current_organization_id` หรือ `app.bypass_rls`) ไว้แล้ว
/// สำหรับ query ที่ RLS policy (ดู migration `row_level_security`) ต้องใช้ตัดสินใจ
///
/// ใช้ `.as_executor()` แทน `&self.pool` ตรง ๆ ใน query แล้วปิดท้ายด้วย `.commit()` เสมอ
/// ถ้าไม่ commit (เช่น return error ก่อนถึง commit) transaction จะ rollback อัตโนมัติตอน
/// drop — ไม่มี state ค้าง ไม่ต้องเขียน rollback มือ
pub struct TenantTx<'a> {
    tx: Transaction<'a, Postgres>,
}

impl<'a> TenantTx<'a> {
    pub fn as_executor(&mut self) -> &mut PgConnection {
        &mut self.tx
    }

    pub async fn commit(self) -> Result<()> {
        self.tx
            .commit()
            .await
            .map_err(|e| Error::Internal(format!("commit tenant transaction failed: {e}")))
    }
}

/// เปิด transaction พร้อมตั้ง `app.current_organization_id` เป็นค่านี้ (transaction-local
/// ผ่าน `set_config(..., true)` — ปลอดภัยกว่า string-format `SET LOCAL` ตรง ๆ เพราะ bind
/// parameter ได้) — ทุก repository method ที่ query ตาราง tenant-scoped ต้องเปิดผ่านนี้
pub async fn begin_tenant(pool: &Pool, organization_id: Uuid) -> Result<TenantTx<'_>> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| Error::Internal(format!("begin tenant transaction failed: {e}")))?;
    sqlx::query("select set_config('app.current_organization_id', $1, true)")
        .bind(organization_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(|e| Error::Internal(format!("set tenant context failed: {e}")))?;
    Ok(TenantTx { tx })
}

/// เปิด transaction แบบ**ข้าม RLS ชั่วคราว** — ใช้เฉพาะ 2 จุด "bootstrap lookup" ที่ยังไม่รู้
/// organization ล่วงหน้า (หา session จาก token hash, หา service identity จาก key hash)
/// เพราะเป็นคีย์สุ่ม 256-bit ที่ค้นแล้วมีแค่แถวเดียวในทั้งระบบอยู่แล้ว การข้าม RLS ตรงนี้จึง
/// ไม่ทำให้ข้อมูลรั่วข้าม tenant จริง (ตรงข้ามกับ endpoint ปกติที่รู้ organization_id อยู่แล้ว
/// และต้องผ่าน `begin_tenant` เสมอ) ดู ADR 0005
pub async fn begin_rls_bypass(pool: &Pool) -> Result<TenantTx<'_>> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| Error::Internal(format!("begin bypass transaction failed: {e}")))?;
    sqlx::query("select set_config('app.bypass_rls', 'on', true)")
        .execute(&mut *tx)
        .await
        .map_err(|e| Error::Internal(format!("set rls bypass failed: {e}")))?;
    Ok(TenantTx { tx })
}
