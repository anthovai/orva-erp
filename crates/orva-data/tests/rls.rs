//! พิสูจน์ว่า Row-Level Security ทำงานที่ระดับ DB จริง — ไม่ใช่แค่ app-layer scoping
//! (ดู migration `row_level_security` และ ADR 0005)

use orva_data::{connect, migrate, DocumentRepository, OrganizationRepository};

fn test_database_url() -> String {
    std::env::var("ORVA_TEST_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://orva_app:orva@localhost:5432/orva_test".to_string())
}

#[tokio::test]
async fn rls_blocks_queries_without_tenant_context() {
    let pool = connect(&test_database_url()).await.expect("connect");
    migrate(&pool).await.expect("migrate");

    let orgs = OrganizationRepository::new(pool.clone());
    let documents = DocumentRepository::new(pool.clone());

    let slug = format!("rls-org-{}", uuid::Uuid::new_v4());
    let org = orgs.create("RLS Org", &slug).await.expect("create org");
    let doc = documents
        .create(org.id, "secret", "tenant data", None)
        .await
        .expect("create document");

    // Query ตรง ๆ ผ่าน pool โดยไม่ตั้ง GUC — ต้องได้ 0 แถวแม้ระบุ id ตรงเป๊ะ
    // (จำลอง bug ที่ลืม scope organization_id ใน query)
    let leaked: Option<(uuid::Uuid,)> = sqlx::query_as("select id from documents where id = $1")
        .bind(doc.id)
        .fetch_optional(&pool)
        .await
        .expect("query runs but policy filters");
    assert!(leaked.is_none(), "RLS must hide rows when GUC is unset");

    // ผ่าน repository (ตั้ง GUC ให้) — ต้องเจอ
    let found = documents
        .find_by_id(org.id, doc.id)
        .await
        .expect("find")
        .expect("visible inside tenant context");
    assert_eq!(found.id, doc.id);
}

#[tokio::test]
async fn rls_isolates_tenants_from_each_other() {
    let pool = connect(&test_database_url()).await.expect("connect");
    migrate(&pool).await.expect("migrate");

    let orgs = OrganizationRepository::new(pool.clone());
    let documents = DocumentRepository::new(pool.clone());

    let org_a = orgs
        .create("Org A", &format!("rls-a-{}", uuid::Uuid::new_v4()))
        .await
        .expect("create org a");
    let org_b = orgs
        .create("Org B", &format!("rls-b-{}", uuid::Uuid::new_v4()))
        .await
        .expect("create org b");

    let doc_a = documents
        .create(org_a.id, "a-doc", "belongs to A", None)
        .await
        .expect("create doc in A");

    // เปิด tenant context ของ B แล้ว query หา doc ของ A แบบ**ไม่กรอง organization_id เลย**
    // — policy ต้องกรองให้เอง
    let mut ttx = orva_data::begin_tenant(&pool, org_b.id)
        .await
        .expect("begin tenant b");
    let cross_tenant: Option<(uuid::Uuid,)> =
        sqlx::query_as("select id from documents where id = $1")
            .bind(doc_a.id)
            .fetch_optional(ttx.as_executor())
            .await
            .expect("query runs");
    ttx.commit().await.expect("commit");
    assert!(
        cross_tenant.is_none(),
        "tenant B must not see tenant A's rows even without a WHERE organization_id clause"
    );

    // WITH CHECK: insert แถวที่อ้าง org อื่นจากใน tenant context ของ B ต้องล้มเหลว
    let mut ttx = orva_data::begin_tenant(&pool, org_b.id)
        .await
        .expect("begin tenant b");
    let smuggle = sqlx::query(
        "insert into documents (organization_id, title, content) values ($1, 'x', 'x')",
    )
    .bind(org_a.id)
    .execute(ttx.as_executor())
    .await;
    assert!(
        smuggle.is_err(),
        "WITH CHECK must reject inserting rows for another tenant"
    );
}
