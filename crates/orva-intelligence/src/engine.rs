use std::sync::Arc;

use orva_data::{
    CreateInsightParams, Event, Insight, InsightRepository, IntelligenceRuleRepository, Pool,
};
use orva_error::Result;
use orva_events::EventBus;
use orva_notifications::NotificationService;

use crate::{
    context::ContextEngine,
    metric::{evaluate_operator, Metric},
};

/// ORVA Intelligence Engine (ARCHITECTURE.md §9) — subscribe ทุก event ผ่าน Event Bus
/// (M5), ประเมิน rule ที่ผูกกับ event_type นั้นด้วย [`ContextEngine`], สร้าง [`Insight`] ถ้า
/// threshold ถูกข้าม แล้วแจ้ง user ที่ rule ระบุไว้ผ่าน Notification (M6) — ปิดวงจร
/// "event pattern → rule → insight → notification" ตาม MILESTONES.md M8 โดยไม่ต้องมี
/// scheduler เพราะประเมินทันทีที่ event ที่เกี่ยวข้องเกิดขึ้นจริง
pub struct IntelligenceEngine {
    rules: IntelligenceRuleRepository,
    insights: InsightRepository,
    context: ContextEngine,
    notifications: Arc<NotificationService>,
}

impl IntelligenceEngine {
    pub fn new(pool: Pool, notifications: Arc<NotificationService>) -> Self {
        Self {
            rules: IntelligenceRuleRepository::new(pool.clone()),
            insights: InsightRepository::new(pool.clone()),
            context: ContextEngine::new(pool),
            notifications,
        }
    }

    pub async fn handle_event(&self, event: &Event) -> Result<()> {
        let rules = self
            .rules
            .list_enabled_for_event_type(event.organization_id, &event.event_type)
            .await?;

        for rule in rules {
            let Some(metric) = Metric::parse(&rule.metric) else {
                tracing::warn!(rule_id = %rule.id, metric = %rule.metric, "unknown metric — skipping rule");
                continue;
            };

            let value = self
                .context
                .compute(
                    event.organization_id,
                    &rule.event_type,
                    &metric,
                    rule.window_seconds,
                )
                .await?;

            if !evaluate_operator(&rule.operator, value, rule.threshold) {
                continue;
            }

            let insight = self
                .insights
                .create(
                    event.organization_id,
                    CreateInsightParams {
                        rule_id: rule.id,
                        rule_name: &rule.name,
                        title: &format!("{} crossed threshold", rule.name),
                        description: &format!(
                            "{} ({}) {} {} = {value} (threshold {})",
                            rule.event_type,
                            rule.metric,
                            rule.operator,
                            rule.window_seconds,
                            rule.threshold
                        ),
                        metric_value: value,
                        threshold: rule.threshold,
                        triggered_event_id: Some(event.id),
                    },
                )
                .await?;

            self.notify_if_configured(event.organization_id, rule.notify_user_id, &insight)
                .await?;
        }

        Ok(())
    }

    async fn notify_if_configured(
        &self,
        organization_id: uuid::Uuid,
        notify_user_id: Option<uuid::Uuid>,
        insight: &Insight,
    ) -> Result<()> {
        if let Some(user_id) = notify_user_id {
            self.notifications
                .notify(
                    organization_id,
                    user_id,
                    "New insight",
                    &insight.description,
                )
                .await?;
        }
        Ok(())
    }
}

/// ผูก [`IntelligenceEngine`] เข้ากับ Event Bus — subscribe ทุก event (`subscribe_all`)
/// เพราะ rule เป็น per-tenant runtime data ไม่รู้ล่วงหน้าตอน compile ว่าจะมี event_type ไหนบ้าง
pub fn subscribe(engine: Arc<IntelligenceEngine>, bus: &EventBus) {
    bus.subscribe_all(Arc::new(move |event| {
        let engine = engine.clone();
        Box::pin(async move { engine.handle_event(&event).await })
    }));
}
