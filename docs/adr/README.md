# Architecture Decision Records (ADR)

บันทึกการตัดสินใจเชิงสถาปัตยกรรมของ ORVA — หนึ่งไฟล์ต่อหนึ่งการตัดสินใจ เรียงตามเลขลำดับ

รูปแบบ: `NNNN-short-title.md` ประกอบด้วย **Status / Context / Decision / Consequences**

| # | เรื่อง | สถานะ |
|---|---|---|
| [0001](0001-core-technology-stack.md) | Core Technology Stack | Accepted |
| [0002](0002-oidc-hs256-foundation.md) | OIDC Foundation ใช้ HS256 + Password Grant ใน v0.1 | Superseded บางส่วนโดย 0006 |
| [0003](0003-event-bus-in-process.md) | Event Bus: In-Process ก่อน ไม่ใช้ Broker ภายนอก | Accepted |
| [0004](0004-module-system-compiled-not-dynamic.md) | Module System: Compile-in ก่อน ไม่ Dynamic-load ใน v0.1 | Accepted |
| [0005](0005-row-level-security.md) | Row-Level Security เป็น defense-in-depth ชั้นที่สอง | Accepted |
| [0006](0006-rs256-jwks.md) | ID token ย้ายเป็น RS256 + JWKS สาธารณะ | Accepted |
| [0007](0007-mfa-totp.md) | MFA ด้วย TOTP แบบ inline ใน login | Accepted |
| [0008](0008-smtp-email.md) | ส่งอีเมลจริงทาง SMTP (lettre + rustls) | Accepted |
| [0009](0009-workflow-definitions.md) | Reusable Workflow Definitions (copy-on-create) | Accepted |
| [0010](0010-recommendations.md) | Recommendation: ข้อเสนอที่มนุษย์ตัดสิน ไม่ใช่ action อัตโนมัติ | Accepted |
| [0011](0011-agent-scopes.md) | Fine-grained Agent Scopes บน Service Identity | Accepted |
| [0012](0012-tenant-rate-limit.md) | Per-tenant Rate Limit (สองชั้นร่วมกับ per-key เดิม) | Accepted |
| [0013](0013-sse-notification-push.md) | Real-time Notification Push ด้วย SSE | Accepted |
| [0014](0014-external-module-adapter.md) | HTTP Adapter สำหรับ OSS Module ที่รันแยก Process | Accepted |
| [0015](0015-unified-ui-shell.md) | Unified UI Shell v0.1: embed ใน binary ไม่มี build step | Accepted |
| [0016](0016-canonical-projection.md) | Canonical Entity Sync แบบ Event-driven Projection | Accepted |
| [0017](0017-orva-knowledge.md) | ORVA Knowledge: linked notes ที่ผูกกับ canonical data | Accepted |
| [0018](0018-ai-intelligence.md) | AI ใน Intelligence Engine: Analyst ที่เสนอ ไม่ execute | Accepted |
| [0019](0019-worker-task-queue.md) | ORVA Worker task queue: pull-based dispatch ไป Execution Plane | Accepted |
