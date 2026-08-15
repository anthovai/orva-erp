use std::sync::Arc;

use orva_events::{catalog, EventBus, PublishOptions};
use orva_notifications::{subscribe_workflow_approval_requests, NotificationService};
use serde_json::json;
use uuid::Uuid;

fn test_database_url() -> String {
    std::env::var("ORVA_TEST_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://orva_app:orva@localhost:5432/orva_test".to_string())
}

/// DoD M6: "มี notification แจ้งผู้อนุมัติ" — เมื่อ workflow เข้าสถานะ pending approval
/// (จำลองด้วยการ publish event ตรง ๆ แบบเดียวกับที่ `orva-workflow` publish จริง)
/// ผู้ที่ถูก assign ต้องได้ in-app notification ทันที
#[tokio::test]
async fn approval_requested_event_creates_in_app_notification_for_assignee() {
    let pool = orva_data::connect(&test_database_url())
        .await
        .expect("connect to test database — is `docker compose up -d` running?");
    orva_data::migrate(&pool).await.expect("run migrations");

    let orgs = orva_data::OrganizationRepository::new(pool.clone());
    let users = orva_data::UserRepository::new(pool.clone());
    let slug = format!("notif-test-{}", Uuid::new_v4());
    let org = orgs.create("Notif Test Org", &slug).await.unwrap();
    let approver = users
        .create(org.id, "approver@notif.test", "Approver", "hash", None)
        .await
        .unwrap();

    let bus = EventBus::new(pool.clone());
    let service = Arc::new(NotificationService::new(pool));
    subscribe_workflow_approval_requests(&bus, service.clone());

    let workflow_instance_id = Uuid::new_v4();
    bus.publish(
        org.id,
        catalog::WORKFLOW_APPROVAL_REQUESTED,
        json!({ "workflow_instance_id": workflow_instance_id, "assigned_to": approver.id }),
        PublishOptions::default(),
    )
    .await
    .expect("publish");

    let notifications = service
        .list_for_user(org.id, approver.id, false)
        .await
        .expect("list notifications");

    // default = เปิดรับทั้ง in_app และ email (opt-out model) เลยได้ 2 แถว
    assert_eq!(notifications.len(), 2);
    let in_app = notifications
        .iter()
        .find(|n| n.channel == "in_app")
        .expect("in_app notification");
    assert!(in_app.body.contains(&workflow_instance_id.to_string()));
    assert!(in_app.read_at.is_none());
    assert!(notifications.iter().any(|n| n.channel == "email"));

    // mark read เฉพาะ in_app
    service
        .mark_read(org.id, in_app.id, approver.id)
        .await
        .expect("mark read");
    let unread = service
        .list_for_user(org.id, approver.id, true)
        .await
        .expect("list unread");
    // email channel ยังไม่ถูก mark read — เหลือแค่แถวนั้น ไม่ใช่ in_app ที่เพิ่ง mark ไป
    assert_eq!(unread.len(), 1);
    assert_eq!(unread[0].channel, "email");
}

/// user ที่ปิด channel email ไว้ต้องไม่มี notification ช่อง email เกิดขึ้น (แต่ in_app ยังมา)
#[tokio::test]
async fn disabled_channel_is_skipped() {
    let pool = orva_data::connect(&test_database_url())
        .await
        .expect("connect");
    orva_data::migrate(&pool).await.expect("migrate");

    let orgs = orva_data::OrganizationRepository::new(pool.clone());
    let users = orva_data::UserRepository::new(pool.clone());
    let slug = format!("notif-pref-{}", Uuid::new_v4());
    let org = orgs.create("Pref Org", &slug).await.unwrap();
    let user = users
        .create(org.id, "user@notif.test", "User", "hash", None)
        .await
        .unwrap();

    let service = NotificationService::new(pool);
    service
        .set_preference(org.id, user.id, orva_notifications::CHANNEL_EMAIL, false)
        .await
        .unwrap();

    service
        .notify(org.id, user.id, "Test", "Body")
        .await
        .unwrap();

    let all = service.list_for_user(org.id, user.id, false).await.unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].channel, orva_notifications::CHANNEL_IN_APP);
}
