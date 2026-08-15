use std::sync::Arc;

use orva_events::EventBus;
use uuid::Uuid;

use crate::NotificationService;

/// ผูก [`NotificationService`] เข้ากับ Event Bus — subscribe เฉพาะ event ที่ต้องแจ้งคน
/// (v0.1: `workflow.approval_requested` เท่านั้น ตาม DoD M6 "มี notification แจ้งผู้อนุมัติ")
///
/// เรียกครั้งเดียวตอน wiring ระดับ application (`orva-core`'s `AppState`/`main.rs`)
pub fn subscribe_workflow_approval_requests(bus: &EventBus, service: Arc<NotificationService>) {
    bus.subscribe(
        orva_events::catalog::WORKFLOW_APPROVAL_REQUESTED,
        Arc::new(move |event| {
            let service = service.clone();
            Box::pin(async move {
                let assigned_to = event
                    .payload
                    .get("assigned_to")
                    .and_then(|v| v.as_str())
                    .and_then(|s| Uuid::parse_str(s).ok())
                    .ok_or_else(|| {
                        orva_error::Error::Internal(
                            "workflow.approval_requested payload missing assigned_to".to_string(),
                        )
                    })?;

                let workflow_instance_id = event
                    .payload
                    .get("workflow_instance_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");

                service
                    .notify(
                        event.organization_id,
                        assigned_to,
                        "Approval requested",
                        &format!("Workflow instance {workflow_instance_id} requires your approval"),
                    )
                    .await
            })
        }),
    );
}
