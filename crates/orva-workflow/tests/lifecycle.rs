use orva_events::EventBus;
use orva_workflow::{Rule, RuleOperator, WorkflowService, WorkflowStatus};
use serde_json::json;
use uuid::Uuid;

fn test_database_url() -> String {
    std::env::var("ORVA_TEST_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://orva_app:orva@localhost:5432/orva_test".to_string())
}

/// เตรียม org + user จริง (events/workflow มี FK ไป organizations/users) คืน
/// (service, organization_id, creator_id, approver_id)
async fn setup() -> (WorkflowService, Uuid, Uuid, Uuid) {
    let pool = orva_data::connect(&test_database_url())
        .await
        .expect("connect to test database — is `docker compose up -d` running?");
    orva_data::migrate(&pool).await.expect("run migrations");

    let orgs = orva_data::OrganizationRepository::new(pool.clone());
    let users = orva_data::UserRepository::new(pool.clone());

    let slug = format!("workflow-test-{}", Uuid::new_v4());
    let org = orgs.create("Workflow Test Org", &slug).await.unwrap();
    let creator = users
        .create(org.id, "creator@wf.test", "Creator", "hash", None)
        .await
        .unwrap();
    let approver = users
        .create(org.id, "approver@wf.test", "Approver", "hash", None)
        .await
        .unwrap();

    let bus = EventBus::new(pool.clone());
    let service = WorkflowService::new(pool, bus);
    (service, org.id, creator.id, approver.id)
}

fn amount_over_100k_rule() -> Rule {
    Rule {
        field: "amount".to_string(),
        operator: RuleOperator::Gt,
        value: json!(100_000),
    }
}

/// DoD M6: workflow ที่**ไม่มี**เงื่อนไข approval ต้องข้ามขั้นตอนอนุมัติไปได้เลย
#[tokio::test]
async fn workflow_without_rule_skips_approval_and_completes() {
    let (service, org_id, creator_id, _approver_id) = setup().await;
    let resource_id = Uuid::new_v4();

    let instance = service
        .create(
            org_id,
            "document",
            resource_id,
            json!({}),
            None,
            Some(creator_id),
        )
        .await
        .unwrap();
    assert_eq!(instance.status, WorkflowStatus::Created.as_str());

    service.start_review(org_id, instance.id).await.unwrap();
    let instance = service
        .evaluate_and_advance(org_id, instance.id, None)
        .await
        .unwrap();
    assert_eq!(instance.status, WorkflowStatus::Executing.as_str());

    let instance = service.complete(org_id, instance.id).await.unwrap();
    assert_eq!(instance.status, WorkflowStatus::Completed.as_str());
}

/// DoD M6 หลัก: "สร้าง workflow ที่มีเงื่อนไข approval ได้จริง" — ตรงตัวอย่าง
/// ARCHITECTURE.md §7 (`IF invoice.amount > 100,000 → Require Manager Approval`)
#[tokio::test]
async fn triggered_rule_requires_approval_from_assigned_approver() {
    let (service, org_id, creator_id, approver_id) = setup().await;
    let resource_id = Uuid::new_v4();

    let instance = service
        .create(
            org_id,
            "invoice",
            resource_id,
            json!({ "amount": 150_000 }),
            Some(amount_over_100k_rule()),
            Some(creator_id),
        )
        .await
        .unwrap();

    service.start_review(org_id, instance.id).await.unwrap();

    // ไม่ส่ง approver มาทั้งที่ rule trigger แล้ว ต้อง error ชัดเจน ไม่ใช่ผ่านเงียบ ๆ
    let err = service
        .evaluate_and_advance(org_id, instance.id, None)
        .await
        .unwrap_err();
    assert!(matches!(err, orva_error::Error::Validation(_)));

    let instance = service
        .evaluate_and_advance(org_id, instance.id, Some(approver_id))
        .await
        .unwrap();
    assert_eq!(instance.status, WorkflowStatus::PendingApproval.as_str());

    // คนอื่นที่ไม่ใช่ approver ที่ถูก assign ต้องอนุมัติไม่ได้
    let stranger_id = Uuid::new_v4();
    // ต้องหา task_id ก่อน — ยังไม่มี API หา task โดยตรงในบททดสอบนี้ ใช้ query ผ่าน repository ตรง ๆ
    let tasks = orva_data::ApprovalTaskRepository::new(
        orva_data::connect(&test_database_url()).await.unwrap(),
    )
    .list_pending_for_user(org_id, approver_id)
    .await
    .unwrap();
    assert_eq!(tasks.len(), 1);
    let task_id = tasks[0].id;

    let err = service
        .approve(org_id, task_id, stranger_id)
        .await
        .unwrap_err();
    assert!(matches!(err, orva_error::Error::Forbidden(_)));

    let instance = service.approve(org_id, task_id, approver_id).await.unwrap();
    assert_eq!(instance.status, WorkflowStatus::Executing.as_str());

    let instance = service.complete(org_id, instance.id).await.unwrap();
    assert_eq!(instance.status, WorkflowStatus::Completed.as_str());
}

/// rule ที่ไม่ trigger (amount ต่ำกว่า threshold) ต้องข้าม approval ไปตรง ๆ
#[tokio::test]
async fn rule_below_threshold_skips_approval() {
    let (service, org_id, creator_id, _approver_id) = setup().await;
    let resource_id = Uuid::new_v4();

    let instance = service
        .create(
            org_id,
            "invoice",
            resource_id,
            json!({ "amount": 50_000 }),
            Some(amount_over_100k_rule()),
            Some(creator_id),
        )
        .await
        .unwrap();

    service.start_review(org_id, instance.id).await.unwrap();
    let instance = service
        .evaluate_and_advance(org_id, instance.id, None)
        .await
        .unwrap();
    assert_eq!(instance.status, WorkflowStatus::Executing.as_str());
}

/// reject เป็น terminal state — approve ต่อไม่ได้อีก
#[tokio::test]
async fn reject_moves_to_terminal_state() {
    let (service, org_id, creator_id, approver_id) = setup().await;
    let resource_id = Uuid::new_v4();

    let instance = service
        .create(
            org_id,
            "invoice",
            resource_id,
            json!({ "amount": 150_000 }),
            Some(amount_over_100k_rule()),
            Some(creator_id),
        )
        .await
        .unwrap();
    service.start_review(org_id, instance.id).await.unwrap();
    service
        .evaluate_and_advance(org_id, instance.id, Some(approver_id))
        .await
        .unwrap();

    let pool = orva_data::connect(&test_database_url()).await.unwrap();
    let tasks = orva_data::ApprovalTaskRepository::new(pool)
        .list_pending_for_user(org_id, approver_id)
        .await
        .unwrap();
    let task_id = tasks[0].id;

    let instance = service
        .reject(org_id, task_id, approver_id, Some("budget exceeded"))
        .await
        .unwrap();
    assert_eq!(instance.status, WorkflowStatus::Rejected.as_str());
}

/// DoD M6: state machine validation — เรียก transition ที่ผิดลำดับต้อง error ไม่ใช่ทำเงียบ ๆ
#[tokio::test]
async fn invalid_transition_is_rejected() {
    let (service, org_id, creator_id, _approver_id) = setup().await;
    let resource_id = Uuid::new_v4();

    let instance = service
        .create(
            org_id,
            "document",
            resource_id,
            json!({}),
            None,
            Some(creator_id),
        )
        .await
        .unwrap();

    // ยังอยู่ใน Created — complete() ตรง ๆ โดยไม่ผ่าน review/execute ต้องถูกปฏิเสธ
    let err = service.complete(org_id, instance.id).await.unwrap_err();
    assert!(matches!(err, orva_error::Error::Validation(_)));
}
