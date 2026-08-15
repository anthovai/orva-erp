use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use orva_events::{catalog, EventBus, PublishOptions};
use orva_notifications::{
    subscribe_workflow_approval_requests, EmailMessage, Mailer, NotificationService,
};
use serde_json::json;
use uuid::Uuid;

/// Mailer จำลอง — บันทึกทุกอีเมลที่ถูกส่ง (หรือ fail ตามสั่ง) ให้ test ตรวจได้
#[derive(Default)]
struct RecordingMailer {
    sent: Mutex<Vec<(String, String, String)>>,
    fail: bool,
}

impl Mailer for RecordingMailer {
    fn send(
        &self,
        message: EmailMessage,
    ) -> Pin<Box<dyn Future<Output = orva_error::Result<()>> + Send + '_>> {
        Box::pin(async move {
            if self.fail {
                return Err(orva_error::Error::Internal("smtp down".to_string()));
            }
            self.sent
                .lock()
                .unwrap()
                .push((message.to, message.subject, message.body));
            Ok(())
        })
    }
}

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

/// ADR 0008: mailer ที่ config ไว้ต้องถูกเรียกส่งจริงไปยัง email ของ user
/// และแถว notification ต้องถูก mark `delivery_status = 'sent'`
#[tokio::test]
async fn configured_mailer_sends_email_and_marks_delivery() {
    let pool = orva_data::connect(&test_database_url())
        .await
        .expect("connect");
    orva_data::migrate(&pool).await.expect("migrate");

    let orgs = orva_data::OrganizationRepository::new(pool.clone());
    let users = orva_data::UserRepository::new(pool.clone());
    let slug = format!("notif-smtp-{}", Uuid::new_v4());
    let org = orgs.create("Smtp Org", &slug).await.unwrap();
    let user = users
        .create(org.id, "recipient@smtp.test", "Recipient", "hash", None)
        .await
        .unwrap();

    let mailer = Arc::new(RecordingMailer::default());
    let service = NotificationService::with_mailer(pool, Some(mailer.clone()));

    service
        .notify(
            org.id,
            user.id,
            "Approval needed",
            "workflow #42 is waiting",
        )
        .await
        .unwrap();

    // ส่งถึง email ของ user จริง หัวข้อ = title
    let sent = mailer.sent.lock().unwrap().clone();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].0, "recipient@smtp.test");
    assert_eq!(sent[0].1, "Approval needed");

    let all = service.list_for_user(org.id, user.id, false).await.unwrap();
    let email_row = all.iter().find(|n| n.channel == "email").unwrap();
    assert_eq!(email_row.delivery_status, "sent");
    assert!(email_row.delivered_at.is_some());
    let in_app_row = all.iter().find(|n| n.channel == "in_app").unwrap();
    assert_eq!(in_app_row.delivery_status, "created");
}

/// การส่งล้มเหลวต้องไม่ทำให้ notify ล้มเหลว — แถวถูก mark `failed` พร้อมเหตุผล
#[tokio::test]
async fn smtp_failure_marks_row_failed_but_notify_succeeds() {
    let pool = orva_data::connect(&test_database_url())
        .await
        .expect("connect");
    orva_data::migrate(&pool).await.expect("migrate");

    let orgs = orva_data::OrganizationRepository::new(pool.clone());
    let users = orva_data::UserRepository::new(pool.clone());
    let slug = format!("notif-smtpfail-{}", Uuid::new_v4());
    let org = orgs.create("SmtpFail Org", &slug).await.unwrap();
    let user = users
        .create(org.id, "victim@smtp.test", "Victim", "hash", None)
        .await
        .unwrap();

    let mailer = Arc::new(RecordingMailer {
        fail: true,
        ..Default::default()
    });
    let service = NotificationService::with_mailer(pool, Some(mailer));

    // ไม่ panic/ไม่ error แม้ SMTP ล่ม
    service
        .notify(org.id, user.id, "Title", "Body")
        .await
        .expect("notify must not fail when smtp is down");

    let all = service.list_for_user(org.id, user.id, false).await.unwrap();
    let email_row = all.iter().find(|n| n.channel == "email").unwrap();
    assert_eq!(email_row.delivery_status, "failed");
    assert!(email_row
        .delivery_error
        .as_deref()
        .unwrap()
        .contains("smtp down"));
    assert!(email_row.delivered_at.is_none());
}
