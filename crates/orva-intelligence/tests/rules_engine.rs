use std::sync::Arc;

use orva_data::{CreateRuleParams, IntelligenceRuleRepository};
use orva_events::{EventBus, PublishOptions};
use orva_intelligence::{subscribe, IntelligenceEngine};
use orva_notifications::NotificationService;
use serde_json::json;
use uuid::Uuid;

fn test_database_url() -> String {
    std::env::var("ORVA_TEST_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://orva_app:orva@localhost:5432/orva_test".to_string())
}

/// M8 DoD: "มี insight เกิดจาก rule จริงอย่างน้อย 1 เคส" — เต็มวงจร
/// event pattern → rule → insight → notification ไม่ต้องมี scheduler เพราะ evaluate
/// ทันทีที่ event ตรงเงื่อนไขเกิดขึ้นจริงผ่าน Event Bus
#[tokio::test]
async fn repeated_event_pattern_creates_insight_and_notifies() {
    let pool = orva_data::connect(&test_database_url())
        .await
        .expect("connect to test database — is `docker compose up -d` running?");
    orva_data::migrate(&pool).await.expect("run migrations");

    let orgs = orva_data::OrganizationRepository::new(pool.clone());
    let users = orva_data::UserRepository::new(pool.clone());
    let slug = format!("intel-test-{}", Uuid::new_v4());
    let org = orgs.create("Intel Test Org", &slug).await.unwrap();
    let manager = users
        .create(org.id, "manager@intel.test", "Manager", "hash", None)
        .await
        .unwrap();

    // rule: แจ้งเตือนถ้ามีการออก service identity ตั้งแต่ 3 ครั้งขึ้นไปในหน้าต่าง 1 ชั่วโมง
    // (สัญญาณความปลอดภัย — เหมาะกับสิ่งที่ Core มีจริงตอนนี้ มากกว่าตัวเลขธุรกิจสมมติ)
    let rules = IntelligenceRuleRepository::new(pool.clone());
    let rule = rules
        .create(
            org.id,
            CreateRuleParams {
                name: "unusual-service-identity-issuance",
                event_type: orva_events::catalog::SERVICE_IDENTITY_ISSUED,
                metric: "count",
                window_seconds: 3600,
                operator: "gte",
                threshold: 3.0,
                notify_user_id: Some(manager.id),
                recommended_action: None,
            },
            manager.id,
        )
        .await
        .unwrap();

    let bus = EventBus::new(pool.clone());
    let notifications = Arc::new(NotificationService::new(pool.clone()));
    let engine = Arc::new(IntelligenceEngine::new(pool.clone(), notifications.clone()));
    subscribe(engine, &bus);

    // event ที่ 1-2: ยังไม่ครบ threshold — ยังไม่ควรมี insight
    for i in 0..2 {
        bus.publish(
            org.id,
            orva_events::catalog::SERVICE_IDENTITY_ISSUED,
            json!({ "name": format!("worker-{i}") }),
            PublishOptions::default(),
        )
        .await
        .unwrap();
    }

    let insights_repo = orva_data::InsightRepository::new(pool.clone());
    let insights = insights_repo.list(org.id, 10).await.unwrap();
    assert!(
        insights.is_empty(),
        "insight ไม่ควรเกิดก่อนถึง threshold แต่เจอ {} รายการ",
        insights.len()
    );

    // event ที่ 3: ครบ threshold แล้ว — ต้องเกิด insight ทันที
    bus.publish(
        org.id,
        orva_events::catalog::SERVICE_IDENTITY_ISSUED,
        json!({ "name": "worker-2" }),
        PublishOptions::default(),
    )
    .await
    .unwrap();

    let insights = insights_repo.list(org.id, 10).await.unwrap();
    assert_eq!(insights.len(), 1);
    assert_eq!(insights[0].rule_id, rule.id);
    assert_eq!(insights[0].metric_value, 3.0);
    assert_eq!(insights[0].threshold, 3.0);

    // notification ต้องถูกส่งให้ manager ตามที่ rule ระบุ
    let notifications_for_manager = notifications
        .list_for_user(org.id, manager.id, false)
        .await
        .unwrap();
    assert!(notifications_for_manager
        .iter()
        .any(|n| n.title == "New insight"));

    // เกิน threshold ต่อไปอีก (ครั้งที่ 4) ต้องเกิด insight เพิ่มอีกรายการ (ไม่ใช่ trigger ครั้งเดียวจบ)
    bus.publish(
        org.id,
        orva_events::catalog::SERVICE_IDENTITY_ISSUED,
        json!({ "name": "worker-3" }),
        PublishOptions::default(),
    )
    .await
    .unwrap();
    let insights = insights_repo.list(org.id, 10).await.unwrap();
    assert_eq!(insights.len(), 2);
}
