use orva_data::{
    connect, migrate, DocumentRepository, OrganizationRepository, TaskRepository, TaskStatus,
    UserRepository,
};

fn test_database_url() -> String {
    std::env::var("ORVA_TEST_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://orva:orva@localhost:5432/orva_test".to_string())
}

#[tokio::test]
async fn organization_and_child_entities_round_trip() {
    let pool = connect(&test_database_url())
        .await
        .expect("connect to test database — is `docker compose up -d` running?");
    migrate(&pool).await.expect("run migrations");

    let orgs = OrganizationRepository::new(pool.clone());
    let users = UserRepository::new(pool.clone());
    let documents = DocumentRepository::new(pool.clone());
    let tasks = TaskRepository::new(pool.clone());

    // ใช้ slug แบบสุ่มกันชนกับ run ก่อนหน้า (unique constraint)
    let slug = format!("test-org-{}", uuid::Uuid::new_v4());
    let org = orgs
        .create("Test Org", &slug)
        .await
        .expect("create organization");
    assert_eq!(org.slug, slug);
    assert!(org.deleted_at.is_none());

    let user = users
        .create(org.id, "owner@test.local", "Owner", "hashed-password", None)
        .await
        .expect("create user");
    assert_eq!(user.organization_id, org.id);

    let doc = documents
        .create(org.id, "Welcome", "hello world", Some(user.id))
        .await
        .expect("create document");
    assert_eq!(doc.created_by, Some(user.id));

    let task = tasks
        .create(org.id, "First task", Some(user.id))
        .await
        .expect("create task");
    assert_eq!(task.status().unwrap(), TaskStatus::Open);

    tasks
        .set_status(org.id, task.id, TaskStatus::Done)
        .await
        .expect("update task status");
    let refreshed = tasks
        .find_by_id(org.id, task.id)
        .await
        .expect("find task")
        .expect("task exists");
    assert_eq!(refreshed.status().unwrap(), TaskStatus::Done);

    // tenant isolation: มองไม่เห็นข้ามองค์กร
    let other_org_id = uuid::Uuid::new_v4();
    assert!(tasks
        .find_by_id(other_org_id, task.id)
        .await
        .expect("query should not error")
        .is_none());

    // soft delete: หายจาก list แต่ยังอยู่ในตาราง
    documents
        .soft_delete(org.id, doc.id)
        .await
        .expect("soft delete document");
    let remaining = documents.list(org.id).await.expect("list documents");
    assert!(remaining.iter().all(|d| d.id != doc.id));

    orgs.soft_delete(org.id).await.expect("soft delete org");
    assert!(orgs
        .find_by_id(org.id)
        .await
        .expect("find org after delete")
        .is_none());
}
