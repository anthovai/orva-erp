use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use orva_events::{catalog, EventBus, PublishOptions};
use serde_json::json;
use uuid::Uuid;

fn test_database_url() -> String {
    std::env::var("ORVA_TEST_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://orva:orva@localhost:5432/orva_test".to_string())
}

async fn bus_with_org() -> (EventBus, orva_data::Pool, Uuid) {
    let pool = orva_data::connect(&test_database_url())
        .await
        .expect("connect to test database — is `docker compose up -d` running?");
    orva_data::migrate(&pool).await.expect("run migrations");

    // events.organization_id มี FK ไป organizations(id) — ต้องมี org จริงก่อน publish
    let slug = format!("events-test-{}", Uuid::new_v4());
    let org = orva_data::OrganizationRepository::new(pool.clone())
        .create("Events Test Org", &slug)
        .await
        .expect("seed organization");

    (EventBus::new(pool.clone()), pool, org.id)
}

/// DoD M5: module A publish → module B รับได้
#[tokio::test]
async fn subscriber_receives_published_event() {
    let (bus, _pool, org_id) = bus_with_org().await;

    let received = Arc::new(AtomicUsize::new(0));
    let received_clone = received.clone();
    bus.subscribe(
        catalog::ROLE_CREATED,
        Arc::new(move |event| {
            let received = received_clone.clone();
            Box::pin(async move {
                assert_eq!(event.event_type, catalog::ROLE_CREATED);
                received.fetch_add(1, Ordering::SeqCst);
                Ok(())
            })
        }),
    );

    // subscribe ผิด type ต้องไม่ถูกเรียก
    let wrong_type_calls = Arc::new(AtomicUsize::new(0));
    let wrong_type_calls_clone = wrong_type_calls.clone();
    bus.subscribe(
        catalog::USER_REGISTERED,
        Arc::new(move |_event| {
            let count = wrong_type_calls_clone.clone();
            Box::pin(async move {
                count.fetch_add(1, Ordering::SeqCst);
                Ok(())
            })
        }),
    );

    bus.publish(
        org_id,
        catalog::ROLE_CREATED,
        json!({ "role_id": Uuid::new_v4() }),
        PublishOptions::default(),
    )
    .await
    .expect("publish");

    assert_eq!(received.load(Ordering::SeqCst), 1);
    assert_eq!(wrong_type_calls.load(Ordering::SeqCst), 0);
}

/// DoD M5: wildcard subscriber ฟังได้ทุก event type (ฐานของ Audit Log ใน M6)
#[tokio::test]
async fn wildcard_subscriber_receives_every_event_type() {
    let (bus, _pool, org_id) = bus_with_org().await;

    let seen_types = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let seen_types_clone = seen_types.clone();
    bus.subscribe_all(Arc::new(move |event| {
        let seen_types = seen_types_clone.clone();
        Box::pin(async move {
            seen_types.lock().unwrap().push(event.event_type);
            Ok(())
        })
    }));

    bus.publish(
        org_id,
        catalog::ORGANIZATION_PROVISIONED,
        json!({}),
        PublishOptions::default(),
    )
    .await
    .unwrap();
    bus.publish(
        org_id,
        catalog::USER_REGISTERED,
        json!({}),
        PublishOptions::default(),
    )
    .await
    .unwrap();

    let seen = seen_types.lock().unwrap().clone();
    assert_eq!(
        seen,
        vec![
            catalog::ORGANIZATION_PROVISIONED.to_string(),
            catalog::USER_REGISTERED.to_string()
        ]
    );
}

/// DoD M5: event ทุกตัวถูก persist และ query ย้อนหลังได้ — แม้ subscriber จะพังก็ตาม
#[tokio::test]
async fn events_are_persisted_and_queryable_even_if_subscriber_fails() {
    let (bus, pool, org_id) = bus_with_org().await;

    bus.subscribe(
        catalog::SERVICE_IDENTITY_ISSUED,
        Arc::new(|_event| Box::pin(async { Err(orva_error::Error::Internal("boom".into())) })),
    );

    let event = bus
        .publish(
            org_id,
            catalog::SERVICE_IDENTITY_ISSUED,
            json!({ "name": "worker" }),
            PublishOptions::default(),
        )
        .await
        .expect("publish must succeed even if subscriber always fails");

    let events = orva_data::EventRepository::new(pool)
        .list(
            org_id,
            orva_data::EventFilter {
                event_type: Some(catalog::SERVICE_IDENTITY_ISSUED),
                ..Default::default()
            },
            10,
        )
        .await
        .expect("list events");

    assert_eq!(events.len(), 1);
    assert_eq!(events[0].id, event.id);
    assert_eq!(events[0].payload["name"], "worker");
}
