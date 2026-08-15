use orva_data::Event;

/// Metric ที่ Context Engine คำนวณจาก event log — เก็บเป็น string ใน DB (`count` หรือ
/// `sum:<field>`) parse ตอน evaluate เท่านั้น ไม่ต้องมี migration เพิ่มถ้าจะเพิ่ม metric ใหม่
pub enum Metric {
    Count,
    SumField(String),
}

impl Metric {
    pub fn parse(raw: &str) -> Option<Self> {
        if raw == "count" {
            return Some(Metric::Count);
        }
        raw.strip_prefix("sum:")
            .map(|field| Metric::SumField(field.to_string()))
    }

    pub fn compute(&self, events: &[Event]) -> f64 {
        match self {
            Metric::Count => events.len() as f64,
            Metric::SumField(field) => events
                .iter()
                .filter_map(|e| e.payload.get(field).and_then(serde_json::Value::as_f64))
                .sum(),
        }
    }
}

/// เทียบตัวเลข — เก็บเป็น string ใน DB เหมือน [`Metric`] (gt/gte/lt/lte/eq)
pub fn evaluate_operator(operator: &str, actual: f64, threshold: f64) -> bool {
    match operator {
        "gt" => actual > threshold,
        "gte" => actual >= threshold,
        "lt" => actual < threshold,
        "lte" => actual <= threshold,
        "eq" => actual == threshold,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use serde_json::json;
    use uuid::Uuid;

    fn make_event(payload: serde_json::Value) -> Event {
        Event {
            id: Uuid::new_v4(),
            organization_id: Uuid::new_v4(),
            event_type: "test.event".to_string(),
            payload,
            actor_user_id: None,
            correlation_id: Uuid::new_v4(),
            occurred_at: Utc::now(),
            resource_type: None,
            resource_id: None,
        }
    }

    #[test]
    fn count_metric_counts_events() {
        let events = vec![make_event(json!({})), make_event(json!({}))];
        assert_eq!(Metric::Count.compute(&events), 2.0);
    }

    #[test]
    fn sum_field_metric_sums_numeric_payload_field() {
        let events = vec![
            make_event(json!({ "amount": 10 })),
            make_event(json!({ "amount": 25 })),
            make_event(json!({ "no_amount": true })),
        ];
        let metric = Metric::parse("sum:amount").unwrap();
        assert_eq!(metric.compute(&events), 35.0);
    }

    #[test]
    fn operators_evaluate_correctly() {
        assert!(evaluate_operator("gt", 5.0, 3.0));
        assert!(!evaluate_operator("gt", 3.0, 3.0));
        assert!(evaluate_operator("gte", 3.0, 3.0));
        assert!(evaluate_operator("lte", 3.0, 3.0));
        assert!(evaluate_operator("eq", 3.0, 3.0));
        assert!(!evaluate_operator("unknown", 3.0, 3.0));
    }
}
