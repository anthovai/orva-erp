//! AI Analyst (ADR 0018) — ชั้น AI จริงของ Intelligence Engine
//!
//! [`Analyst`] เป็น trait เพื่อให้ core ฉีด stub ตอน test ได้ (CI ไม่ยิง network)
//! implementation จริงคือ [`ClaudeAnalyst`] — เรียก Anthropic Messages API ตรง ๆ
//! ผ่าน reqwest (Rust ไม่มี official SDK) พร้อม structured output (json_schema)
//! เพื่อให้คำตอบ parse ได้เสมอ
//!
//! หลักการเดียวกับ ADR 0010: AI **เสนอ** เท่านั้น ไม่ execute อะไรเอง —
//! recommendation ที่ AI สร้างเข้า loop accept/dismiss ของมนุษย์ตามปกติ

use std::future::Future;
use std::pin::Pin;

use orva_error::{Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const DEFAULT_MODEL: &str = "claude-opus-5";
const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";

/// ผลวิเคราะห์จาก AI — `recommendation` มีค่าเมื่อ AI เห็นว่ามี action ที่ควรเสนอ
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiAnalysis {
    pub analysis: String,
    pub recommendation: Option<AiRecommendation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiRecommendation {
    pub title: String,
    pub description: String,
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// จุดต่อ AI ของ Intelligence Engine — dyn-safe เพื่อฉีด stub ใน test
pub trait Analyst: Send + Sync {
    /// วิเคราะห์ context ขององค์กร (JSON ที่ core รวบรวมมา) ตามคำถามที่ user ตั้ง
    /// (`None` = ให้วิเคราะห์ภาพรวม)
    fn analyze<'a>(
        &'a self,
        context: &'a Value,
        question: Option<&'a str>,
    ) -> BoxFuture<'a, Result<AiAnalysis>>;
}

/// Analyst จริง — Anthropic Messages API
pub struct ClaudeAnalyst {
    client: reqwest::Client,
    api_key: String,
    model: String,
}

const SYSTEM_PROMPT: &str = "You are the AI analyst inside ORVA ERP's Intelligence Engine. \
You receive a JSON snapshot of one organization's operational context (recent event activity, \
insights from threshold rules, pending recommendations, canonical entity counts) and answer \
the operator's question about it — or give an overall health analysis when no question is asked. \
Answer in the same language as the question (default Thai). Be concrete: cite the numbers and \
event types in the context rather than generic advice. Only propose a recommendation when the \
context clearly supports a specific, actionable next step for a human to approve; otherwise \
return null for recommendation. You never execute actions — humans accept or dismiss your \
recommendations through ORVA's normal approval loop.";

impl ClaudeAnalyst {
    pub fn new(api_key: String, model: Option<String>) -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .expect("build anthropic http client"),
            api_key,
            model: model.unwrap_or_else(|| DEFAULT_MODEL.to_string()),
        }
    }

    /// body ของ request — แยกเป็น fn เพื่อ unit test รูป request ได้โดยไม่ยิง network
    fn request_body(&self, context: &Value, question: Option<&str>) -> Value {
        let question_text = question.unwrap_or(
            "Give an overall analysis of this organization's current operational state.",
        );
        json!({
            "model": self.model,
            "max_tokens": 4096,
            "system": SYSTEM_PROMPT,
            "output_config": {
                "format": {
                    "type": "json_schema",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "analysis": {
                                "type": "string",
                                "description": "The analysis answering the operator's question, grounded in the provided context."
                            },
                            "recommendation": {
                                "anyOf": [
                                    { "type": "null" },
                                    {
                                        "type": "object",
                                        "properties": {
                                            "title": { "type": "string" },
                                            "description": { "type": "string" }
                                        },
                                        "required": ["title", "description"],
                                        "additionalProperties": false
                                    }
                                ],
                                "description": "A concrete next action for a human to approve, or null when none is warranted."
                            }
                        },
                        "required": ["analysis", "recommendation"],
                        "additionalProperties": false
                    }
                }
            },
            "messages": [{
                "role": "user",
                "content": format!(
                    "Organization context (JSON):\n{context}\n\nQuestion: {question_text}"
                ),
            }],
        })
    }

    /// แกะ response ของ Messages API → [`AiAnalysis`] — แยกเป็น fn เพื่อ unit test
    fn parse_response(body: &Value) -> Result<AiAnalysis> {
        if body["stop_reason"] == "refusal" {
            return Err(Error::Validation(
                "AI declined to analyze this request".to_string(),
            ));
        }
        let text = body["content"]
            .as_array()
            .and_then(|blocks| {
                blocks
                    .iter()
                    .find(|b| b["type"] == "text")
                    .and_then(|b| b["text"].as_str())
            })
            .ok_or_else(|| Error::Internal("AI response contained no text block".to_string()))?;
        serde_json::from_str(text)
            .map_err(|e| Error::Internal(format!("AI response was not valid analysis JSON: {e}")))
    }
}

impl Analyst for ClaudeAnalyst {
    fn analyze<'a>(
        &'a self,
        context: &'a Value,
        question: Option<&'a str>,
    ) -> BoxFuture<'a, Result<AiAnalysis>> {
        Box::pin(async move {
            let response = self
                .client
                .post(ANTHROPIC_API_URL)
                .header("x-api-key", &self.api_key)
                .header("anthropic-version", ANTHROPIC_VERSION)
                .json(&self.request_body(context, question))
                .send()
                .await
                .map_err(|e| Error::Internal(format!("anthropic request failed: {e}")))?;

            let status = response.status();
            let body: Value = response
                .json()
                .await
                .map_err(|e| Error::Internal(format!("anthropic response not JSON: {e}")))?;
            if !status.is_success() {
                let message = body["error"]["message"].as_str().unwrap_or("unknown error");
                return Err(Error::Internal(format!(
                    "anthropic API error ({status}): {message}"
                )));
            }
            Self::parse_response(&body)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_body_has_model_schema_and_context() {
        let analyst = ClaudeAnalyst::new("test-key".into(), None);
        let body = analyst.request_body(&json!({"insights": []}), Some("why so quiet?"));
        assert_eq!(body["model"], DEFAULT_MODEL);
        assert_eq!(
            body["output_config"]["format"]["schema"]["required"],
            json!(["analysis", "recommendation"])
        );
        let content = body["messages"][0]["content"].as_str().unwrap();
        assert!(content.contains("insights"));
        assert!(content.contains("why so quiet?"));
    }

    #[test]
    fn parse_response_extracts_analysis_and_recommendation() {
        let body = json!({
            "stop_reason": "end_turn",
            "content": [{
                "type": "text",
                "text": r#"{"analysis":"all good","recommendation":{"title":"T","description":"D"}}"#
            }]
        });
        let out = ClaudeAnalyst::parse_response(&body).unwrap();
        assert_eq!(out.analysis, "all good");
        assert_eq!(out.recommendation.unwrap().title, "T");
    }

    #[test]
    fn parse_response_handles_null_recommendation_and_refusal() {
        let ok = json!({
            "stop_reason": "end_turn",
            "content": [{"type": "text", "text": r#"{"analysis":"quiet","recommendation":null}"#}]
        });
        assert!(ClaudeAnalyst::parse_response(&ok)
            .unwrap()
            .recommendation
            .is_none());

        let refusal = json!({"stop_reason": "refusal", "content": []});
        assert!(ClaudeAnalyst::parse_response(&refusal).is_err());
    }
}
