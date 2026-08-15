use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

/// Conditional rule ตาม ARCHITECTURE.md §7 เช่น `IF invoice.amount > 100,000 → Require Manager Approval`
/// เก็บเป็น jsonb ทั่วไปแทนการผูกกับ entity เฉพาะทาง (invoice) เพราะยังไม่มี business module จริง —
/// `field` คือ key ใน `context` jsonb ของ workflow instance
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Rule {
    pub field: String,
    pub operator: RuleOperator,
    pub value: Value,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RuleOperator {
    Gt,
    Gte,
    Lt,
    Lte,
    Eq,
}

impl Rule {
    /// `true` = เงื่อนไข trigger (ต้องขอ approval) — เทียบเฉพาะตัวเลขในเวอร์ชันนี้
    /// (พอสำหรับกรณีใช้งานจริงตาม ARCHITECTURE.md เช่น amount/leave_days) ถ้า field หาไม่เจอ
    /// หรือเทียบชนิดไม่ได้ ถือว่าไม่ trigger (fail-safe: ข้าม approval ดีกว่า panic)
    pub fn evaluate(&self, context: &Value) -> bool {
        let Some(actual) = context.get(&self.field).and_then(Value::as_f64) else {
            return false;
        };
        let Some(expected) = self.value.as_f64() else {
            return false;
        };

        match self.operator {
            RuleOperator::Gt => actual > expected,
            RuleOperator::Gte => actual >= expected,
            RuleOperator::Lt => actual < expected,
            RuleOperator::Lte => actual <= expected,
            RuleOperator::Eq => actual == expected,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn invoice_amount_over_threshold_triggers_approval() {
        let rule = Rule {
            field: "amount".to_string(),
            operator: RuleOperator::Gt,
            value: json!(100_000),
        };
        assert!(rule.evaluate(&json!({ "amount": 150_000 })));
        assert!(!rule.evaluate(&json!({ "amount": 50_000 })));
    }

    #[test]
    fn missing_field_does_not_trigger() {
        let rule = Rule {
            field: "amount".to_string(),
            operator: RuleOperator::Gt,
            value: json!(100_000),
        };
        assert!(!rule.evaluate(&json!({ "other_field": 1 })));
    }
}
