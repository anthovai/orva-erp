# ORVA Core v0.1 — Development Milestones

> แตกจาก Scope ใน [ARCHITECTURE.md §16](ARCHITECTURE.md) · สถานะ: Draft · อัปเดตล่าสุด: 2026-08-14

หลักการเรียงลำดับ: **สิ่งที่ทุกอย่างต้องพึ่งพา มาก่อน** — Data Layer และ Identity เป็นฐานของทุก milestone ถัดไป, Event Bus ต้องมาก่อน Workflow และ Intelligence Foundation, Module System มาท้าย ๆ เพราะต้องรู้ก่อนว่า contract ครอบคลุมอะไรบ้าง

```
M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8
โครง   Data  Identity RBAC+  API   Event Workflow Module  Intelligence
Rust  Layer  +SSO    Tenant Gateway Bus  +Audit   System  Foundation
                                        +Notify           = v0.1 🏁
```

---

## M0 — Project Foundation (โครง Rust)

ตั้งโครงให้ทีมพัฒนาต่อได้ทันที ยังไม่มี business logic

- [x] Rust workspace layout (`core/`, `crates/`, `modules/`) — แยก crate ตาม domain
- [x] เลือกและล็อก stack หลัก: tokio + axum + sqlx + serde (ดู [ADR 0001](adr/0001-core-technology-stack.md))
- [x] Config system (env + file, แยก per-environment) — `orva-config`
- [x] Error handling + logging/tracing มาตรฐานกลาง — `orva-error` + tracing
- [x] CI: build + test + clippy + fmt — `.github/workflows/ci.yml`
- [x] Docker compose สำหรับ dev (PostgreSQL 17)
- [x] ADR (Architecture Decision Records) เริ่มบันทึกการตัดสินใจ

**Definition of Done:** `cargo build && cargo test` ผ่านบน CI, มี health-check endpoint รันได้จริง

> ✅ **เสร็จ 2026-08-14** — build/test/clippy/fmt ผ่านทั้งหมด, `GET /health` ตอบ `{"status":"ok"}` จริง (ยังเหลือยืนยัน CI บน GitHub เมื่อ push ครั้งแรก)
>
> หมายเหตุเครื่อง dev (Windows): ใช้ toolchain `stable-x86_64-pc-windows-gnu` + WinLibs mingw-w64 ที่ `%USERPROFILE%\tools\mingw64\bin` (อยู่ใน user PATH แล้ว) เพราะเครื่องไม่มี MSVC Build Tools — CI ใช้ Linux ไม่ได้รับผลกระทบ

## M1 — Data Layer (Canonical Data Model)

ฐานของทุกอย่าง — ต้องมาก่อน Identity เพราะ User/Organization ก็คือ canonical entity

- [x] Database schema + migration system — `sqlx-cli`, reversible migrations ใน `crates/orva-data/migrations`
- [x] นิยาม Canonical Entities ชุดแรก: `User`, `Organization`, `Document`, `Task` (ที่เหลือ — Employee, Customer, Vendor, Product, Project, Invoice, Transaction, Ticket — นิยาม placeholder ไว้ใน `orva_data::canonical`)
- [x] Repository pattern / data access layer กลาง — `OrganizationRepository`, `UserRepository`, `DocumentRepository`, `TaskRepository` ชื่อ method เดียวกันทุกตัว (`create`/`find_by_id`/`list`/`soft_delete`)
- [x] Soft delete + timestamps + created_by มาตรฐานทุก entity (ยกเว้น Organization ที่เป็น tenant root ไม่มี created_by)
- [x] **Tenant column ในทุกตาราง ตั้งแต่ migration แรก** — `organization_id` + index กรอง `deleted_at is null`

**Definition of Done:** migrate ขึ้น–ลงได้สะอาด, CRUD canonical entity ผ่าน data layer ได้พร้อม test

> ✅ **เสร็จ 2026-08-14** — integration test (`crates/orva-data/tests/crud.rs`) ครอบ CRUD ครบ + พิสูจน์ tenant isolation (มองข้าม organization ไม่เห็น) + soft delete (หายจาก list แต่ยังอยู่ในตาราง) ทั้งหมดผ่านจริงกับ PostgreSQL 17 (docker compose), ต่อเข้า `orva-core` แล้ว — server connect + migrate ตอน startup จริง (`database connected and migrated` ใน log) ก่อนเปิด `/health`
>
> CI เพิ่ม postgres service container สำหรับรัน integration test อัตโนมัติ (`ORVA_TEST_DATABASE_URL`)
>
> การตัดสินใจย่อยที่ทำระหว่างทาง: ใช้ `sqlx::query_as` runtime API แทน `query_as!` macro เพื่อเลี่ยงความซับซ้อนของ offline-cache ในช่วงที่ schema ยังไม่นิ่ง — พิจารณาเปลี่ยนเป็น compile-time checked macro ทีหลังถ้าต้องการความปลอดภัยเพิ่มตอน schema เริ่มนิ่ง

## M2 — Identity & Authentication

- [x] User registration / login (credential-based)
- [x] Session management (issue, revoke) — opaque token, hash เก็บใน DB ไม่เก็บ raw token (revoke เต็ม, **refresh ยังไม่ implement** — เห็นเป็น scope cut ด้านล่าง)
- [x] Password hashing (argon2) + policy (ขั้นต่ำ 8 ตัวอักษร)
- [x] Organization + Team model — schema + repository พร้อม (`teams`, `team_members`) ยังไม่มี HTTP API เพราะไม่อยู่ใน DoD ของ M2
- [x] Service Identity (สำหรับ module/worker เรียก API) — endpoint ออก API key ได้ ยังไม่มี middleware ฝั่ง verify แบบ end-to-end (มีแค่ `authenticate_service_key` ใน `AuthService` รอ M7 ต่อเข้าจริง)
- [x] OIDC provider foundation — discovery document + userinfo endpoint + JWT ID token (ดูข้อจำกัดด้านล่าง)
- [x] โครงรองรับ MFA — column `mfa_enabled`/`mfa_secret` บน `users` เท่านั้น ~~ยังไม่มี TOTP logic ตามที่ตั้งใจ~~ → **TOTP logic เสร็จ 2026-08-15** (setup/activate/disable + บังคับตอน login — ดู [ADR 0007](adr/0007-mfa-totp.md), `core/tests/mfa_flow.rs`)

**Definition of Done:** login → ได้ session/token → เรียก API ที่ต้อง auth ได้; OSS ตัวทดสอบหนึ่งตัว SSO ผ่าน ORVA ได้

> ✅ **เสร็จบางส่วน 2026-08-14** — ส่วน "login → session/token → เรียก API ที่ต้อง auth ได้" **พิสูจน์แล้วจริงทั้งอัตโนมัติและ manual**:
> - Integration test (`core/tests/auth_flow.rs`) ครอบ register → login (+ wrong-password ต้อง 401) → เรียก `/api/v1/auth/me` ด้วย token (และไม่มี token ต้อง 401) → logout → session ใช้ต่อไม่ได้ (service identity ย้ายไปทดสอบใน `authz_flow.rs` ตอน M3 เพราะกลายเป็น route ที่ต้อง permission)
> - ทดสอบ manual ผ่าน curl กับ server จริงเช่นกัน (register/login/me/discovery ทำงานถูกต้อง)
>
> ส่วน **"OSS ตัวทดสอบหนึ่งตัว SSO ผ่าน ORVA ได้" ยังไม่ทำ** — ตามที่คุยกันไว้ตอนเริ่ม M2 ว่ายังไม่ต่อ Module ในรอบนี้ จึงไม่มี relying party จริงให้ทดสอบ SSO แบบ end-to-end เก็บเป็นงานค้างไปทำตอน M7 (Module System) หรือเมื่อเริ่มต่อ OSS module จริง (Horilla/InvenTree ฯลฯ)
>
> **ข้อจำกัดที่ตั้งใจตัดออกจาก v0.1 (ไม่ใช่บั๊ก):**
> - JWT ID token ใช้ **HS256 (shared secret)** ไม่ใช่ RS256 — เพราะยังไม่มี relying party ภายนอกที่ต้อง verify ผ่าน JWKS สาธารณะ จะย้ายเป็น RS256 ตอนมี module จริงมาเชื่อม (บันทึกใน ADR 0002)
> - Authorization Code flow แบบ redirect เต็มรูปแบบยังไม่ทำ — token endpoint ปัจจุบันคือ `/api/v1/auth/login` แบบ credential ตรง ๆ (คล้าย password grant) เพราะไม่มี client/UI จริงให้ทดสอบ redirect
> - Session refresh ยังไม่มี (มีแค่ issue/revoke, TTL คงที่ 24 ชม.)
> - Team API (HTTP) ยังไม่มี — มีแค่ data layer/repository
> - Service Identity middleware (ให้ route จริงยอมรับ `X-Orva-Service-Key`) ยังไม่ต่อ — รอ M7

## M3 — Authorization & Multi-Tenant

- [x] Role & Permission model: `User → Role → Permission → Resource → Action` — `roles`, `permissions` (catalog กลาง), `role_permissions`, `user_roles`
- [x] Permission key format: `<module>.<resource>.<action>` — seed แล้ว 5 ตัว: `core.organization.manage`, `core.user.manage`, `core.team.manage`, `core.role.manage`, `core.service_identity.manage`
- [x] Policy engine — `orva_auth::authz` (`Authorizer::check`, `Policy` trait, ตัวอย่าง `OwnerOnly`) แยกจาก permission check ชัดเจน (permission ตอบ "ทำ action นี้ได้ไหม" policy ตอบ "ทำกับ resource ชิ้นนี้ได้ไหม")
- [x] Permission middleware สำหรับ API route — `RequirePermission<K: PermissionKey>` extractor (compile-time เช็ค route ↔ permission key ตรงกัน) ใช้กับทุก route ที่แก้ไข/สร้าง resource ระดับองค์กร (ดูขอบเขตด้านล่าง)
- [x] Tenant isolation บังคับที่ data layer — ทุก repository method ของ tenant-scoped entity บังคับรับ `organization_id` เป็น parameter (compile ไม่ผ่านถ้าลืม) + ทุก route มอบ/ตรวจ role ยืนยันซ้ำว่า resource (role, user) เป็นขององค์กรผู้เรียกก่อนแก้ไข (กัน cross-tenant privilege escalation)
- [x] Tenant provisioning (สร้าง/ระงับ organization) — `POST /api/v1/organizations` (สร้าง org + owner + role "owner" ที่มีทุก permission แบบ atomic ระดับ application, login ให้ทันที), `POST /api/v1/organizations/current/suspend` (soft-delete, ต้อง `core.organization.manage`)

**Definition of Done:** integration test พิสูจน์ว่า user ข้าม tenant ไม่ได้ และ permission ถูก enforce ทุก route

> ✅ **เสร็จ 2026-08-14** — `core/tests/authz_flow.rs` (3 tests, รันซ้ำได้ไม่ชนกัน — สุ่ม slug/email ทุกครั้ง):
> - `permission_is_enforced_on_protected_routes` — owner (permission ครบจาก provisioning) สร้าง service identity ได้ (201); สมาชิกที่ `/register` เข้ามาเฉย ๆ (ไม่มี role) โดนปฏิเสธ **403** (ไม่ใช่ 401 — แยกความต่างระหว่าง "ไม่ auth" กับ "auth แล้วแต่ไม่มีสิทธิ์"); หลัง owner สร้าง role ใหม่ + grant permission + assign ให้สมาชิก แล้วสมาชิกทำ action เดิมได้สำเร็จ (201)
> - `cross_tenant_role_operations_are_rejected` — owner องค์กร A เอา `role_id` ขององค์กร B ไปยิง `grant_permission`/`assign` ได้ **404** ทั้งคู่ (ไม่ใช่ 403 — มองไม่เห็น resource เลย ไม่ใช่แค่ไม่มีสิทธิ์)
> - `suspend_organization_requires_permission_and_blocks_future_login` — suspend สำเร็จ (204) แล้ว login ด้วย credential เดิมล้มเหลว (401) ทันที
> - ยืนยัน manual ผ่าน curl กับ server จริงด้วย (provision → `/me/permissions` เห็นครบ 5 key → สร้าง role ได้)
>
> **ขอบเขตที่ตัดออกอย่างตั้งใจ:**
> - `provision_organization` ไม่ได้ wrap เป็น DB transaction เดียว (สร้าง org → user → role → grant → assign เป็นหลายคำสั่งแยก) — ถ้า fail กลางทางจะเหลือข้อมูลค้าง เป็น known gap รอ hardening pass ทีหลัง (ไม่กระทบ correctness ของ test เพราะ path สำเร็จเท่านั้นที่ทดสอบ)
> - ~~**DB-level tenant isolation (Postgres Row-Level Security) ยังไม่ทำ**~~ → **ทำแล้ว 2026-08-15** (post-v0.1 hardening) — migration `row_level_security` เปิด `ENABLE`+`FORCE` RLS + policy ทุกตาราง tenant-scoped, ทุก repository query ผ่าน `begin_tenant` (ตั้ง GUC per-transaction), เชื่อมต่อด้วย role `orva_app` ที่ไม่ใช่ superuser, พิสูจน์ใน `crates/orva-data/tests/rls.rs` — ดู [ADR 0005](adr/0005-row-level-security.md)
> - `/api/v1/auth/register` ยังเป็น route สาธารณะที่ไม่ต้อง invite — ใครก็ตามที่รู้ organization slug สมัครเข้าองค์กรนั้นได้เอง (ไม่มี role ติดตัว) เป็นการตัดสินใจ v0.1 ไม่ใช่บั๊ก — invite-only flow เก็บไว้พิจารณาทีหลัง
> - Permission middleware ไม่ได้ครอบ "ทุก" route ตามตัวอักษร — route สาธารณะ (`/health`, `/.well-known/...`, `/register`, `/login`, `/organizations` สำหรับ signup) และ route แบบ "อ่านข้อมูลตัวเอง" (`/me`, `/userinfo`, `/me/permissions`) ตั้งใจไม่ผูก permission เพราะไม่มีอะไรให้ authorize เกินกว่า "login แล้วหรือยัง"

## M4 — API Gateway

- [x] REST API structure + versioning (`/api/v1/`) — มีตั้งแต่ M2/M3 อยู่แล้ว ทุก route ผ่าน `orva_core::app()` router เดียว
- [x] Authentication middleware (token validation) — `AuthUser`/`RequirePermission<K>` extractor (มีตั้งแต่ M2/M3)
- [x] Rate limiting per user/tenant — keyed ด้วย bearer token (proxy ของ user) ตกไป IP (`ConnectInfo`) แล้วตกไป "anonymous" ถ้าไม่มีทั้งคู่ — `governor` crate, 100 req/min ต่อ key
- [x] Request validation + error response มาตรฐาน — `ValidatedJson<T>` extractor (`validator` crate) แปลง deserialize/validation failure ทุกแบบให้เป็น `{"error": "..."}` 400 เดียวกันหมด (ไม่ใช่ plain-text rejection ของ axum)
- [x] OpenAPI spec generation — `utoipa` annotate ทุก handler จริง ไม่ใช่เขียนสเปกแยกมือ, serve ที่ `/api-docs/openapi.json`
- [x] CORS + security headers — `tower_http::cors::CorsLayer` (permissive ใน v0.1) + `X-Content-Type-Options`/`X-Frame-Options`/`Referrer-Policy`

**Definition of Done:** ทุก endpoint ผ่าน gateway เดียว, มี OpenAPI docs อัตโนมัติ

> ✅ **เสร็จ 2026-08-15** — `core/tests/gateway_flow.rs` (4 tests):
> - `invalid_request_returns_standard_error_shape` — email ผิดรูปแบบ, password สั้นกว่านโยบาย, และ JSON เพี้ยนทั้งชิ้น ทั้ง 3 กรณีตอบ 400 + `{"error": "..."}` เหมือนกันหมด ไม่มี panic/500
> - `rate_limit_returns_429_after_quota_exhausted` — ใช้ `AppState::with_rate_limit(..., 2)` (quota ต่ำเฉพาะ test) ยิง 2 ครั้งผ่าน ครั้งที่ 3 ได้ 429 จริง
> - `responses_include_security_headers_and_cors` — เช็ค header ครบทั้ง 3 ตัว + `access-control-allow-origin` มาจริง
> - `openapi_spec_lists_all_routes` — ดึง `/api-docs/openapi.json` จริงแล้วเช็คว่ามีครบทุก path สำคัญ (ไม่ได้เดาว่า annotate ครบ)
> - ยืนยัน manual ผ่าน curl กับ server จริงด้วย: Swagger UI ที่ `/docs` ตอบ 303 (redirect ไป UI), openapi.json มีเนื้อหาจริง, security/CORS headers มาครบ, validation error message อ่านง่าย
>
> **ขอบเขตที่ตัดออกอย่างตั้งใจ:**
> - CORS ใช้ `CorsLayer::permissive()` (ทุก origin) เพราะยังไม่มี Unified UI จริงให้ล็อก origin ที่แน่นอน — **ต้องจำกัด origin ก่อนขึ้น production**
> - ~~Rate limit key เป็น bearer token/IP ระดับ "proxy ของ user" ไม่ใช่ organization_id จริง~~ → **per-tenant enforce จริงแล้ว 2026-08-15** — ชั้นที่สองบังคับใน auth extractor (หลังรู้ tenant), quota ต่อองค์กร configurable ผ่าน API + cache 60 วิ — ดู [ADR 0012](adr/0012-tenant-rate-limit.md) (per-key limiter เดิมยังคงอยู่เป็นชั้นแรกก่อน auth)
> - ไม่มี CSP (Content-Security-Policy) header — ยังไม่มีหน้า HTML ให้ป้องกัน (ยังไม่มี Unified UI)
> - Rate limiter เป็น in-memory ต่อ process — ถ้า scale เป็นหลาย instance ต้องย้ายไป shared store (Redis) ทีหลัง

## M5 — Event Bus

หัวใจของ Event-Driven Architecture — ต้องเสร็จก่อน Workflow / Notification / Intelligence

- [x] Event schema มาตรฐาน (type, payload, tenant, actor, timestamp, correlation id) — ตาราง `events` (append-only): `event_type`, `payload` (jsonb), `organization_id`, `actor_user_id`, `correlation_id`, `occurred_at`
- [x] Publish / Subscribe ภายใน process — `orva_events::EventBus` (`subscribe` ต่อ event_type, `subscribe_all` แบบ wildcard)
- [x] Event persistence (event log — เป็นฐานของ Audit และ Intelligence) — persist ก่อนแจ้ง subscriber เสมอ, ไม่มี soft delete/update (immutable)
- [x] Delivery guarantee + retry policy — retry 3 ครั้งต่อ subscriber (ไม่มี backoff จริง), ถ้า fail ครบก็ log แล้วปล่อยผ่าน เพราะ event ถูก persist แล้วตั้งแต่ต้น (ดูรายละเอียดในขอบเขตด้านล่าง)
- [x] Event catalog: นิยาม event ชุดแรก — `organization.provisioned`, `organization.suspended`, `user.registered`, `service_identity.issued`, `role.created`, `role.assigned` (`orva_events::catalog`) ต่อเข้ากับ `AuthService` จริงทุกจุดที่มี state change (ไม่ใช่แค่นิยามไว้เฉย ๆ)
- [x] ตัดสินใจ (ADR): in-process ก่อน หรือใช้ broker ภายนอก (NATS/RabbitMQ) ตั้งแต่แรก — [ADR 0003](adr/0003-event-bus-in-process.md): in-process ก่อน, ทบทวนตอน M7 (Module System) ที่ module เริ่มรันแยก process จริง

**Definition of Done:** module A publish → module B รับได้, event ทุกตัวถูก persist และ query ย้อนหลังได้

> ✅ **เสร็จ 2026-08-14** — `crates/orva-events/tests/pubsub.rs` (3 tests) + `core/tests/events_flow.rs` (2 tests):
> - `subscriber_receives_published_event` — publish event type หนึ่ง subscriber ที่ subscribe ตรง type ได้รับ, subscriber ที่ subscribe type อื่นไม่ได้รับ
> - `wildcard_subscriber_receives_every_event_type` — `subscribe_all` เห็นทุก event เรียงตามลำดับ publish จริง
> - `events_are_persisted_and_queryable_even_if_subscriber_fails` — subscriber ที่ return Err เสมอ **ไม่ทำให้ publish() fail** และ event ยัง query กลับมาเจอผ่าน `EventRepository::list` (พิสูจน์ "event log เป็น source of truth ไม่ใช่ subscriber")
> - `provisioning_publishes_and_is_queryable_via_api` (core, HTTP-level) — เรียก `POST /api/v1/organizations` จริงผ่าน HTTP แล้ว subscriber ที่ผูกไว้ล่วงหน้าบน `AppState.event_bus` ได้รับ event ทันที **และ** `GET /api/v1/events` (ผ่าน permission ใหม่ `core.event.read` ที่ owner ได้มาอัตโนมัติตอน provisioning) เห็น event เดียวกัน
> - `events_are_isolated_per_tenant` — org B query event log แล้วไม่เห็น event ของ org A (tenant isolation ใช้กับ event log เหมือนข้อมูลอื่น)
> - ยืนยัน manual ผ่าน curl กับ server จริงด้วย: provision → create role → `GET /api/v1/events` เห็นทั้ง `organization.provisioned` และ `role.created` เรียงล่าสุดก่อน, filter ด้วย `?event_type=` ทำงานถูกต้อง
>
> **ขอบเขตที่ตัดออกอย่างตั้งใจ:**
> - Dispatch เป็น **synchronous** (await subscriber ทีละตัวก่อน `publish()` คืนค่า) — subscriber ช้าจะหน่วง caller โดยตรง ยอมรับได้ตอนนี้เพราะยังไม่มี subscriber ที่ทำงานหนัก (M6 Notification/Audit จะเป็นตัวแรกที่ทดสอบสมมติฐานนี้จริงจัง)
> - Retry ไม่มี backoff จริง (retry ติดกันทันที 3 ครั้ง) — เพียงพอสำหรับ subscriber ที่ fail ชั่วครู่ ไม่รองรับ transient failure ที่ต้องรอนาน
> - Event bus เป็น in-process ล้วน (ดู ADR 0003) — ใช้ไม่ได้กับ module ที่รันเป็น service แยก process/ภาษาต่างกัน ต้องแก้ตอน M7
> - ไม่มี event schema versioning — ถ้า payload shape เปลี่ยนทีหลัง subscriber เก่าอาจอ่านผิด ยังไม่ได้ออกแบบ migration strategy สำหรับ event payload

## M6 — Workflow Engine + Audit Log + Notification

สามตัวนี้ต่อยอดจาก Event Bus โดยตรง จึงรวมเป็น milestone เดียว

Workflow:
- [x] Workflow definition: `Create → Review → Approve → Execute → Complete` — `orva-workflow` crate, ผูกกับ (resource_type, resource_id) แบบ generic เพราะยังไม่มี business module จริง
- [x] Conditional rules (เช่น `IF invoice.amount > 100,000 → Require Manager Approval`) — `orva_workflow::Rule` เก็บเป็น jsonb เทียบ field/operator/value กับ context ของ instance
- [x] State machine + transition validation — `validate_transition()` ปฏิเสธทุก transition ที่ไม่อยู่ใน allow-list ด้วย `Error::Validation` (ทดสอบแล้วว่า `complete()` ตรง ๆ จาก `Created` โดนบล็อก)
- [x] Human approval task (assign, approve, reject) — `approval_tasks` table, เช็คว่าต้องเป็น user ที่ถูก `assigned_to` เท่านั้นถึงจะ approve/reject ได้ (ไม่ใช่ permission กว้าง ๆ — เป็น ownership check ต่อ task)

Audit Log:
- [x] Audit trail จาก event log (ใคร ทำอะไร กับอะไร เมื่อไหร่ ใน tenant ไหน) — **ไม่สร้างตารางแยก** ใช้ `events` table เดิม (M5) เป็นฐานตรง ๆ เพิ่มแค่ `resource_type`/`resource_id` column ให้ query ตรง ๆ ได้โดยไม่ต้องแกะ payload jsonb
- [x] Audit query API (filter ตาม user/resource/ช่วงเวลา) — ขยาย `GET /api/v1/events` เดิมให้รับ `actor_user_id`, `resource_type`, `resource_id`, `occurred_from`, `occurred_to` ผสมกันได้ (ใช้ `sqlx::QueryBuilder` ประกอบ WHERE แบบ dynamic)

Notification:
- [x] Notification service subscribe จาก Event Bus — `orva-notifications` crate, `subscribe_workflow_approval_requests()` ผูกกับ `workflow.approval_requested` โดยเฉพาะ (ตาม DoD "แจ้งผู้อนุมัติ" ไม่ใช่ subscribe ทุก event)
- [x] Channel แรก: in-app + email (ช่องทางอื่นเป็น extension) — in-app เต็มรูปแบบ (list/mark-read); email แค่บันทึกแถวไว้ ยังไม่ส่งจริง (ดูขอบเขตด้านล่าง)
- [x] User notification preferences — `notification_preferences` table, opt-out model (ไม่มี row = เปิดรับ), `PUT /api/v1/notification-preferences`

**Definition of Done:** สร้าง workflow ที่มีเงื่อนไข approval ได้จริง, ทุก action มี audit, มี notification แจ้งผู้อนุมัติ

> ✅ **เสร็จ 2026-08-15** — พิสูจน์ครบ DoD ทั้งระดับ crate และ HTTP จริง:
> - `orva-workflow/tests/lifecycle.rs` (5 tests): workflow ไม่มี rule ข้าม approval ได้เอง, rule trigger แล้วต้องมี approver ไม่งั้น validation error, คนอื่นที่ไม่ใช่ approver อนุมัติไม่ได้ (Forbidden), rule ต่ำกว่า threshold ข้าม approval, reject เป็น terminal state, เรียก transition ผิดลำดับ (`complete()` จาก `Created`) ถูกปฏิเสธ
> - `orva-notifications/tests/wiring.rs` (2 tests): publish `workflow.approval_requested` แล้ว assignee ได้ notification จริงทั้ง in_app+email (default เปิดทั้งคู่), ปิด channel ผ่าน preference แล้วช่องนั้นหายไปจริง
> - `core/tests/workflow_flow.rs` (2 tests, HTTP-level เต็มรูปแบบ) — **`invoice_workflow_with_conditional_approval_end_to_end`** ครอบทั้ง flow: provision org → สร้าง workflow ผูก "invoice" พร้อม rule `amount > 100,000` (context `amount: 150000`) → start-review → advance (มอบ manager) → เข้า `pending_approval` → manager เห็นงานใน `/approval-tasks/mine` → **manager มี notification จริงใน `/notifications`** → คนอื่นอนุมัติไม่ได้ (403) → manager อนุมัติสำเร็จ → `executing` → complete → `completed` → **`GET /api/v1/events?resource_type=invoice&resource_id=...` เห็นครบทั้ง 4 event** (`workflow.created/approval_requested/approved/completed`) พิสูจน์ audit trail เต็มเส้น; อีก test ยืนยัน transition ผิดลำดับได้ 400 ที่ระดับ HTTP ด้วย
> - ยืนยัน manual ผ่าน server จริง: ดึง OpenAPI spec เช็คว่ามีครบทุก endpoint ใหม่ (`/workflows`, `/approval-tasks`, `/notifications`, `/notification-preferences`)
>
> **ขอบเขตที่ตัดออกอย่างตั้งใจ:**
> - ~~**Email channel ไม่ส่งจริง**~~ → **ส่งจริงแล้ว 2026-08-15** — SMTP ผ่าน lettre+rustls, opt-in ด้วย config `[email]`/env `ORVA_SMTP_*`, delivery status (`sent`/`failed`) บันทึกลงแถว notification, dev ใช้ Mailpit ใน docker-compose — ดู [ADR 0008](adr/0008-smtp-email.md)
> - ~~Workflow ยัง**ไม่มี named/reusable definition**~~ → **ทำแล้ว 2026-08-15** — ตาราง `workflow_definitions` + `POST/GET /api/v1/workflow-definitions`, สร้าง instance อ้าง `definition_id` (copy-on-create), default approver fallback ตอน advance — ดู [ADR 0009](adr/0009-workflow-definitions.md)
> - Rule evaluator เทียบได้แค่ตัวเลข (`as_f64`) — string/date comparison ยังไม่รองรับ
> - `Rejected` เป็น terminal จริง ไม่มี "resubmit"/retry flow — ต้องสร้าง workflow instance ใหม่ถ้าจะลองใหม่
> - ~~Notification ยังไม่มี real-time push (WebSocket/SSE)~~ → **มีแล้ว 2026-08-15** — SSE ที่ `GET /api/v1/notifications/stream` (best-effort, DB ยังเป็น source of truth) — ดู [ADR 0013](adr/0013-sse-notification-push.md)

## M7 — Module System

มาท้าย ๆ เพราะ contract ต้องครอบคลุมสิ่งที่ M1–M6 สร้างไว้

- [x] Module Contract: `Manifest, Version, Dependencies, Permissions, APIs, Events, Database, UI, Configuration` — `orva_module_sdk::ModuleManifest` (Manifest/Version/Dependencies/Permissions/Events); APIs มาจาก `Module::router`, Database จาก `Module::migrate` (Notes ไม่ต้องมีเพราะใช้ `Document` เดิม), UI/Configuration ยังไม่มีความหมายจนกว่าจะมี Unified UI (Phase หลัง v0.1)
- [x] Module registry (install / enable / disable per tenant) — `ModuleRegistry` (compile-time list) + `module_installations` table (runtime per-tenant state) — ดู [ADR 0004](adr/0004-module-system-compiled-not-dynamic.md) สำหรับเหตุผลที่เลือก compile-in ไม่ dynamic-load
- [x] Module lifecycle hooks (install, upgrade, uninstall) — install/enable/disable ผ่าน `POST /api/v1/modules/{name}/install|enable|disable`; **"upgrade"/"uninstall" ยังไม่ implement จริง** (ดูขอบเขตด้านล่าง)
- [x] Permission registration — module ประกาศ permission key ของตัวเองเข้าระบบกลาง — `ModuleRegistry::initialize()` เรียก `PermissionRepository::upsert` ให้ทุก module ตอน server เริ่มทำงาน (idempotent)
- [x] Event registration — module ประกาศ event ที่ publish/subscribe — `ModuleManifest.events_published`/`events_subscribed` (v0.1: ประกาศเพื่อ introspection/`GET /api/v1/modules` เท่านั้น ยังไม่ enforce runtime ว่า module publish ตรงกับที่ประกาศจริง)
- [x] **Reference module** หนึ่งตัว (เช่น Notes/Knowledge อย่างง่าย) เพื่อพิสูจน์ contract ทั้งเส้น — `orva-module-notes` (CRUD บน `Document` entity เดิมของ M1)

**Definition of Done:** reference module ติดตั้งผ่าน module system, ใช้ identity/permission/event ของ Core ครบ โดยไม่แตะโค้ด Core

> ✅ **เสร็จ 2026-08-15** — สร้าง `orva-module-sdk` (SDK ที่ core และ module พึ่งพาร่วมกัน — `Module` trait, `ModuleManifest`, `ModuleContext`, `RequireModulePermission<K>` extractor ที่เช็คทั้ง "module install/enable แล้วหรือยัง" **และ** "user มี permission ไหม" ในตัวเดียว) แล้วสร้าง reference module `orva-module-notes` บนฐานนั้น
>
> **พิสูจน์ 2 ระดับ:**
> - **แบบเดี่ยว ๆ ไม่พึ่ง orva-core เลย** (`orva-module-notes/tests/module.rs`, 1 test) — ประกอบ `AuthService` + `EventBus` + `ModuleContext` ตรง ๆ, สร้าง user, upsert permission ของ module เข้า catalog, พิสูจน์ install-gate (403 ก่อน install), permission-gate (403 หลัง install แต่ยังไม่มี role), สำเร็จหลัง grant role, event ที่ module publish เห็นได้ผ่าน `EventRepository` ของ Core ตรง ๆ (ไม่ใช่ event bus แยก)
> - **ผ่าน orva-core เต็มรูปแบบ** (`core/tests/module_flow.rs`, 1 test, HTTP-level) — `GET /api/v1/modules` เห็น "notes" ที่ compile เข้ามาพร้อม manifest ครบ, route ของ module ก่อน install ได้ 403, install ผ่าน Core API (`core.module.manage`) สำเร็จ, owner สร้าง note ได้ทันที (เพราะได้ permission ของ module มาอัตโนมัติตอน provisioning — module ลงทะเบียน permission ก่อนมี tenant ไหนถูกสร้างด้วยซ้ำ), **สมาชิกธรรมดาที่ไม่มี role โดน 403 แม้ module install แล้ว** (พิสูจน์ permission-check แยกจาก install-check จริง), event ของ module (`notes.document.created`) เห็นผ่าน `GET /api/v1/events` เดียวกับ event อื่นทั้งหมด, disable module แล้ว route กลับไปโดนปฏิเสธทันทีแม้ permission ยังอยู่ครบ
> - ยืนยัน manual ผ่าน server จริง: OpenAPI มีครบ 4 module-management endpoints, `GET /api/v1/modules` คืน manifest จริงของ "notes"
>
> **ขอบเขตที่ตัดออกอย่างตั้งใจ (บันทึกใน [ADR 0004](adr/0004-module-system-compiled-not-dynamic.md) ด้วย):**
> - **ไม่ dynamic-load** — module ต้อง compile เข้า binary เดียวกับ orva-core เสมอ เพิ่ม/ถอด module ต้อง recompile+redeploy "install" ที่มีความหมายจริงคือ per-tenant enable ไม่ใช่ "ติดตั้งโค้ดใหม่ตอน runtime"
> - **"upgrade"/"uninstall" ยังไม่ implement** — มีแค่ install (upsert version + enable) และ enable/disable ถ้า module version เปลี่ยน ระบบจะ update version field ตอน install ซ้ำ แต่ไม่มี migration-between-versions logic ใด ๆ
> - **Event registration ไม่ enforce runtime** — `events_published`/`events_subscribed` ใน manifest เป็นแค่ metadata สำหรับแสดงผล (`GET /api/v1/modules`) ไม่มีการเช็คว่า module publish event ตรงกับที่ประกาศไว้จริงหรือเปล่า
> - **module ที่เป็น OSS ภายนอก (Horilla, InvenTree) ใช้ mechanism นี้ไม่ได้เลย** — SDK ปัจจุบันเป็น Rust trait ตรง ๆ เหมาะกับ module ที่เขียนเป็น Rust crate เท่านั้น การต่อ OSS module จริง (Python/Django, รันแยก service) ต้องออกแบบ adapter แบบอื่น (เช่น HTTP proxy ผ่าน service identity ที่มีอยู่แล้วจาก M2) เป็นงานที่ยังไม่เริ่ม

## M8 — Intelligence Foundation 🏁 = ORVA Core v0.1

ยังไม่ใช่ AI — เป็น infrastructure ที่ทำให้ Intelligence ต่อยอดได้

- [x] Context Engine: รวบรวม context จาก events + data ต่อ tenant — `orva_intelligence::ContextEngine` อ่านจาก `events` table (M5) ตรง ๆ คำนวณ metric (`count` หรือ `sum:<field>`) ในช่วงเวลาที่กำหนดต่อ organization ไม่มี state ของตัวเอง
- [x] Rules engine อย่างง่าย (threshold/pattern → insight) — `intelligence_rules` table (per-tenant, runtime-configurable ผ่าน API ไม่ hardcode) + `IntelligenceEngine` ที่ subscribe ทุก event ผ่าน Event Bus (M5) แล้วประเมิน rule ที่ผูกกับ event_type นั้นทันที **ไม่ต้องมี scheduler**
- [x] Insight storage + API (`Insight`, `Recommendation` entities) — `insights` table (append-only เหมือน events) + `GET /api/v1/insights`; `Recommendation` **implement แล้ว 2026-08-15** (ดู ADR 0010)
- [x] **ORVA Agent API** — จุดเชื่อมสำหรับ ORVA Worker (OpenWorker) ใน Phase ถัดไป: agent authentication (service identity) ผ่าน header ใหม่ `X-Orva-Service-Key` (ต่อ `ServiceIdentity`/`authenticate_service_key` ที่มีอยู่แล้วตั้งแต่ M2 แต่ไม่เคยมี route ใช้จริงจนถึงตอนนี้), scoped permissions (v0.1 = tenant-scoped เท่านั้น ดูขอบเขตด้านล่าง), approval hook เข้า Workflow Engine — agent เรียก `WorkflowService` ตัวเดียวกับที่ user ใช้ผ่าน `POST /api/v1/agent/workflows`
- [x] ตัวอย่าง end-to-end หนึ่งเคส: event pattern → rule → insight → notification — เคสจริง: "แจ้งเตือนถ้ามีการออก service identity ตั้งแต่ 3 ครั้งขึ้นไปใน 1 ชั่วโมง" (สัญญาณความปลอดภัย ใช้ event ที่ Core มีอยู่แล้วจริง แทนตัวเลขธุรกิจสมมติที่ไม่มีข้อมูลจริงรองรับ)

**Definition of Done:** มี insight เกิดจาก rule จริงอย่างน้อย 1 เคส และ external agent ต่อผ่าน Agent API ด้วย service identity ได้

> ✅ **เสร็จ 2026-08-15 — ปิด ORVA Core v0.1 🏁** สร้าง 2 crate ใหม่: `orva-intelligence` (Context Engine + Rules Engine ผูกกับ Event Bus) และขยาย `orva-core` ด้วย Agent API (`ServiceIdentityAuth` extractor ใหม่)
>
> **พิสูจน์ครบ DoD ทั้งสองข้อ ที่ระดับ crate และ HTTP:**
> - **Insight จาก rule จริง** — `orva-intelligence/tests/rules_engine.rs` (1 test, crate-level): publish event 2 ครั้งยังไม่ถึง threshold → ไม่มี insight; ครั้งที่ 3 ถึง threshold ทันที → insight เกิด + notification ส่งถึงผู้รับที่ rule ระบุ; publish ต่อครั้งที่ 4 → insight เกิดเพิ่มอีกรายการ (ไม่ใช่ trigger ครั้งเดียวจบ) — `core/tests/intelligence_flow.rs` (1 test, HTTP-level): สร้าง rule ผ่าน `POST /api/v1/intelligence/rules` จริง → สร้าง role ผ่าน `POST /api/v1/roles` ปกติ 2 ครั้ง (ไม่ยิง event bus ตรง ๆ) → `GET /api/v1/insights` เห็น insight จริง → `GET /api/v1/notifications` เห็นการแจ้งเตือนจริง
> - **Agent ต่อผ่าน service identity ได้** — `core/tests/agent_flow.rs` (3 tests, HTTP-level): ไม่มี key/key ปลอม → 401, key จริง → `GET /api/v1/agent/context` เห็นตัวตนถูกต้อง; agent เสนอ action ที่มี rule trigger approval → `pending_approval` → **human อนุมัติผ่าน endpoint เดิมของ user** (`/approval-tasks/{id}/approve` — คนละช่องทางกับ agent แต่ workflow เดียวกัน) → agent poll เห็นเปลี่ยนเป็น `executing` จริง; action ที่ไม่มี rule → `executing` ทันทีไม่ต้องรอใคร
> - ยืนยัน manual ผ่าน server จริงทั้งคู่: OpenAPI มีครบทุก endpoint ใหม่ (`/agent/*`, `/intelligence/rules`, `/insights`), agent context + propose action ทำงานถูกต้องผ่าน curl จริง
>
> **ขอบเขตที่ตัดออกอย่างตั้งใจ:**
> - ~~**`Recommendation` entity ไม่ implement**~~ → **ทำแล้ว 2026-08-15** — action ที่ผูกได้เกิดขึ้นจริงแล้วผ่าน Workflow Definitions (ADR 0009): rule ประกาศ `recommended_action` → trigger สร้าง Recommendation → มนุษย์ accept แล้วได้ workflow instance ที่ยังผ่าน approval ปกติ — ดู [ADR 0010](adr/0010-recommendations.md)
> - ~~**Agent scoped permissions เป็น tenant-scope เท่านั้น**~~ → **fine-grained แล้ว 2026-08-15** — `service_identities.scopes` (fail-closed, validate ตอนออก key, propose จำกัดต่อ resource_type ได้) — ดู [ADR 0011](adr/0011-agent-scopes.md)
> - **Context Engine อ่าน events table ทั้งหมดในช่วงเวลาทุกครั้งที่ประเมิน** ไม่มี pre-aggregation/materialized view — พอสำหรับ v0.1 แต่จะช้าลงเมื่อ event เยอะขึ้นมาก (ต้องปรับตอน scale จริง)
> - **Metric รองรับแค่ตัวเลข** (count/sum) — ยังไม่มี pattern matching แบบซับซ้อนกว่านี้ (เช่น sequence detection, anomaly ทางสถิติ) ตรงตามคำว่า "Rules engine อย่างง่าย" ใน checklist
> - **JWT ยังเป็น HS256** ตามที่ตัดสินใจไว้ใน [ADR 0002](adr/0002-oidc-hs256-foundation.md) — Agent API ใช้ opaque service key ไม่ใช่ JWT อยู่แล้ว จึงไม่กระทบ แต่ตอนที่ ORVA Worker ต้องการ verify token เองผ่าน JWKS (ไม่ผ่าน ORVA Core ตรง ๆ) ยังต้องย้ายเป็น RS256 ตามที่ ADR นั้นทิ้งไว้

---

## 🏁 ORVA Core v0.1 — สรุปสถานะ

ครบทั้ง 9 milestones (M0–M8) — **Rust Core Platform พร้อมสำหรับ Phase ถัดไป** (เลือก OSS ประกอบเป็น Business Modules ตาม [OSS-STRATEGY.md](OSS-STRATEGY.md))

สิ่งที่ยังไม่ทำเป็น **known gap ที่บันทึกไว้ครบทุกจุด** ไม่ใช่สิ่งที่ถูกลืม: ~~RLS ระดับ DB (M3)~~ (**ปิดแล้ว 2026-08-15** — [ADR 0005](adr/0005-row-level-security.md)), ~~RS256/JWKS~~ (**ปิดแล้ว 2026-08-15** — [ADR 0006](adr/0006-rs256-jwks.md)), ~~MFA TOTP~~ (**ปิดแล้ว 2026-08-15** — [ADR 0007](adr/0007-mfa-totp.md)), ~~email ไม่ส่งจริง (M6)~~ (**ปิดแล้ว 2026-08-15** — [ADR 0008](adr/0008-smtp-email.md)) เหลือ full OIDC redirect flow (M2), ~~rate limit ต่อ tenant จริง (M4)~~ (**ปิดแล้ว 2026-08-15** — [ADR 0012](adr/0012-tenant-rate-limit.md)), ~~workflow definition แบบ reusable (M6)~~ (**ปิดแล้ว 2026-08-15** — [ADR 0009](adr/0009-workflow-definitions.md)), dynamic module loading (M7 — สำหรับ OSS module มี [ADR 0014](adr/0014-external-module-adapter.md) เป็นคำตอบแทนแล้ว), ~~Recommendation~~ (**ปิดแล้ว 2026-08-15** — [ADR 0010](adr/0010-recommendations.md)) + ~~fine-grained agent scope~~ (**ปิดแล้ว 2026-08-15** — [ADR 0011](adr/0011-agent-scopes.md)) (M8) — ทั้งหมดมี ADR หรือหมายเหตุอ้างอิงให้ตามไปอ่านตอนถึงเวลาต้องแก้จริง

---

## หลัง v0.1 (Phase ถัดไป — ไม่อยู่ใน scope นี้)

- ~~ORVA Worker integration (OpenWorker เต็มรูปแบบ)~~ → **เสร็จ 2026-08-16 ทั้งสองฝั่ง** — ORVA: คิวงาน + Agent API ให้ worker poll/claim/รายงานผล ([ADR 0019](adr/0019-worker-task-queue.md)); OpenWorker: tools `orva_poll_tasks` / `orva_claim_task` / `orva_report_task_result` (`anthovai/openworker` commit c7b22c2)
- ~~ORVA Knowledge (สร้างเองตามแนวคิด linked notes / knowledge graph)~~ → **v0.1 เสร็จ 2026-08-16** — notes + `[[wikilink]]` + backlinks + graph + ลิงก์ canonical entity ([ADR 0017](adr/0017-orva-knowledge.md))
- เลือก OSS สำหรับ Business Modules — โครง adapter พร้อมแล้ว ([ADR 0014](adr/0014-external-module-adapter.md)); **Horilla HRM เชื่อมจริงแล้ว 2026-08-15 (Phase 1 — ดู [modules/horilla.md](modules/horilla.md))**
- ~~Unified UI shell~~ → **v0.1 เสร็จ 2026-08-15** — `/ui` embed ใน binary ([ADR 0015](adr/0015-unified-ui-shell.md))
- ~~AI ใน Intelligence Engine (จาก rules → analytics → AI)~~ → **v0.1 เสร็จ 2026-08-16** — AI analyst ถาม-ตอบกับ context องค์กร + AI-sourced recommendation เข้า loop accept/dismiss ([ADR 0018](adr/0018-ai-intelligence.md))
