use orva_core::AppState;

pub fn test_database_url() -> String {
    std::env::var("ORVA_TEST_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://orva:orva@localhost:5432/orva_test".to_string())
}

pub async fn test_state() -> AppState {
    let pool = orva_data::connect(&test_database_url())
        .await
        .expect("connect to test database — is `docker compose up -d` running?");
    orva_data::migrate(&pool).await.expect("run migrations");

    AppState::new(pool, "test-secret", "orva-core-test").await
}

/// สร้าง organization ใหม่แบบ slug สุ่ม กันชนกับ run ก่อนหน้า (unique constraint)
///
/// ใช้เฉพาะ `auth_flow.rs` — binary อื่นไม่ได้เรียก ทำให้ dead_code warning ขึ้นเฉพาะที่นั่น (ปกติของ shared test helper module ที่ integration test แต่ละไฟล์ compile แยกกัน)
#[allow(dead_code)]
pub async fn seed_organization(state: &AppState) -> orva_data::Organization {
    // AppState ไม่ expose pool ตรง ๆ (เจตนา — auth service เป็นทางเข้าเดียว) จึงต่อ pool ใหม่เฉพาะ setup
    let pool = orva_data::connect(&test_database_url())
        .await
        .expect("connect for seeding");
    let orgs = orva_data::OrganizationRepository::new(pool);
    let slug = format!("test-org-{}", uuid::Uuid::new_v4());
    let _ = state; // เผื่ออนาคตต้องใช้ state ประกอบ
    orgs.create("Test Org", &slug)
        .await
        .expect("seed organization")
}
