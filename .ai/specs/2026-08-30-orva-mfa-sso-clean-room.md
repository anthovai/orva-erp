# Clean-room step-up authentication: orva_mfa (TOTP) + orva_sso (OIDC)

**Date**: 2026-08-30
**Status**: Ready for implementation

## TLDR

Rebuild the enterprise-only SSO/MFA capabilities as two app-owned modules —
`orva_mfa` (TOTP second factor with recovery codes) and `orva_sso` (generic
OIDC single sign-on) — using only public extension points: the
`auth.login:form` injection spot, the `auth/login` after-interceptor (which
controls the issued cookie token), global backend page middleware, audience-
scoped JWTs, the declarative encryption map, and the documented session-
issuance sequence (`authService.getUserRoles → updateLastLoginAt →
createSession → signJwt`). No upstream file is modified and nothing from
`@open-mercato/enterprise` is read or imported (clean-room requirement in
CLAUDE.md).

## Resolved assumptions (autonomous defaults)

| # | Question | Default chosen | Rationale |
|---|---|---|---|
| Q1 | One spec or two (MFA vs SSO are independently deployable)? | One spec, two modules, strictly phased — Phase 1 (`orva_mfa`) ships alone | User requested both together; modules stay independently disableable |
| Q2 | MFA factor | TOTP (RFC 6238, SHA-1, 6 digits, 30 s) + 8 single-use recovery codes | Universal authenticator-app support; no SMS/push infra |
| Q3 | MFA policy | Per-user self-service enrollment; enforced once active. Tenant-wide "require MFA" policy deferred | Smallest surface; policy adds admin UX + grace flows |
| Q4 | QR code | Manual key entry + copyable `otpauth://` URI only; QR image needs a new dependency (`qrcode`) — deferred, **⚠ NEEDS HUMAN CONFIRMATION** to add the dep later | AGENTS: ask before dependencies |
| Q5 | SSO protocol | OIDC authorization-code + PKCE against a per-tenant connection (works with Google/Microsoft/Keycloak). SAML deferred | `jose` already in the tree for JWKS verification |
| Q6 | SSO user provisioning | Existing users only, matched by verified email; unknown email fails closed. JIT provisioning deferred | Never widen access by default |
| Q7 | Sudo/step-up for sensitive actions | Out of scope (record-locking is a separate future module) | Scope cohesion |

## Problem Statement

Upstream keeps SSO/MFA in the proprietary `@open-mercato/enterprise` package,
which Orva must not use (license forbids SaaS). Orva sells to Thai businesses
whose accounting data demands stronger sign-in than password-only, and larger
customers require IdP login. Without these, Orva cannot pass security reviews.

## Goals

- **REQ-001** — A user can enroll a TOTP authenticator, confirm it with a
  valid code, and receive 8 recovery codes shown exactly once.
- **REQ-002** — After password login, an MFA-enrolled user cannot reach any
  `/backend` page or issue a full staff session until a valid TOTP or unused
  recovery code is presented; non-enrolled users are unaffected.
- **REQ-003** — A user can disable MFA with a valid code; secrets are
  encrypted at rest and recovery codes stored only as hashes.
- **REQ-004** — (Phase 3) A tenant admin can configure an OIDC connection;
  users whose email domain matches sign in through the IdP and land in a
  normal staff session, existing users only.

## Non-goals

SAML, WebAuthn/passkeys, SMS OTP, tenant-wide MFA mandates, JIT user
provisioning, IdP-initiated SSO, sudo re-prompt on sensitive actions.

## Proposed Solution

### Architecture (verified against installed contracts)

```text
password login ──POST /api/auth/login──► core auth route (untouched)
        │ 200 { token, redirect }
        ▼
orva_mfa after-interceptor (targetRoute 'auth/login')
        │ user has ACTIVE credential?
        ├─ no  → body passes through (normal session)
        └─ yes → replace body.token with signAudienceJwt('orva_mfa_pending', …, 300 s)
                 + { mfaRequired: true, redirect: '/mfa' }
                 → core sets auth_token cookie to the PENDING token
                 → pending token has wrong audience + no sid ⇒ rejected by
                   getAuthFromRequest everywhere ⇒ no privileged surface opens
        ▼
/mfa (frontend page, orva_mfa) — code form
        │ POST /api/orva_mfa/verify { code }
        ▼
verify route: verifyAudienceJwt('orva_mfa_pending') from auth_token cookie
  → TOTP window ±1 / recovery-code hash match (single use)
  → session issuance (autologin.ts pattern): getUserRoles → updateLastLoginAt
    → createSession → signJwt({ …, sid, mfa: true }) → set auth_token cookie
  → record sid in orva_mfa_session_flags
        ▼
backend page middleware (global '/backend*', belt-and-braces):
  auth.mfa === true → continue
  else if user enrolled AND sid not flagged → redirect '/mfa'
  (covers sessions minted before enrollment and token refresh dropping the claim)
```

SSO (Phase 3) reuses the same issuance block:

```text
/login email field ──auth.login:form widget──► GET /api/orva_sso/discover?email
  match → setAuthOverride({ 'Continue with SSO', onSubmit: GET /api/orva_sso/start })
start: state+nonce+PKCE in signed short-lived cookies → IdP authorize URL
callback: code exchange (fetch) → ID token verified with jose createRemoteJWKSet
  → email must match an existing active user in the connection's tenant (fail closed)
  → session issuance with claims { idp: connectionId, mfa: true }
```

- **Why `mfa: true` on SSO sessions:** the IdP owns its own MFA; Orva must not
  double-challenge (industry norm).
- **Rate limiting / lockout:** verify route tracks `failed_attempts` +
  `locked_until` on the credential (5 fails → 60 s, exponential ×2 up to 15 m).
- **Replay:** `last_used_step` stored; a TOTP step may be consumed once.

### Design decisions

| Decision | Rationale | Alternative rejected |
|---|---|---|
| Gate at token issuance via after-interceptor token swap | The cookie is derived from `interceptedBody.token` (login.ts:234-236) — the only public seam that prevents a full session from ever existing pre-MFA | Page-middleware-only gating (APIs stay open) |
| `signAudienceJwt('orva_mfa_pending')` for the challenge | Audience-derived key ⇒ pending token can never verify as `staff`; no sid ⇒ session-integrity rejects it too | Custom cookie + hand-rolled token |
| TOTP implemented on `node:crypto` per RFC 4226/6238 with test vectors | No public OTP util exists; standard-algorithm implementation with published vectors is the clean-room path | New dependency (needs approval) |
| Secrets via declarative `encryption.ts` map + `findOneWithDecryption` | Platform rule: never hand-roll AES / bypass TenantDataEncryptionService | Imperative service calls |
| Recovery codes stored with `hashAuthToken` (core public lib) | Same primitive core uses for session/reset tokens | bcrypt per code (slow, unneeded) |
| Namespaces `orva_mfa`/`orva_sso`, env `ORVA_MFA_*` | Upstream commercial module owns `security.*` / `OM_SECURITY_MFA_*` — avoid collision | Reusing `security` module id |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Feature IDs |
|---|---|---|---|
| Any staff user | enroll/activate/disable own MFA, verify challenge | own user id from trusted `auth.sub` only | `orva_mfa.self` |
| Tenant admin | view/manage SSO connections | tenant+org from auth ctx | `orva_sso.view`, `orva_sso.manage` |

`tenantId`/`organizationId` always derived from the verified token (staff or
`orva_mfa_pending`); never from the request body. Fail closed.

## Data Models

### `orva_mfa:totp_credential` (`orva_mfa_totp_credentials`)
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id / organization_id | uuid | RLS via `orva_apply_rls()` |
| user_id | uuid, partial-unique where deleted_at is null | one credential per user |
| secret | text, **encrypted** (encryption map) | base32, shown only at enroll |
| status | text 'pending'\|'active' | activate flips once |
| label | text null | device label |
| last_used_step | bigint null | replay guard |
| failed_attempts / locked_until | int / timestamptz null | lockout |
| activated_at / created_at / updated_at / deleted_at | timestamptz | soft delete |

### `orva_mfa:recovery_code` (`orva_mfa_recovery_codes`)
id, tenant_id, organization_id, user_id, code_hash (text, `hashAuthToken`),
used_at null, created_at, updated_at, deleted_at. Append-only per generation
batch; regenerating disables previous batch.

### `orva_mfa:session_flag` (`orva_mfa_session_flags`)
id, tenant_id, organization_id, user_id, session_id (unique), verified_at,
created_at, updated_at. Row = "this session passed MFA"; consulted by the page
middleware when the JWT claim is absent (e.g. refreshed tokens).

### `orva_sso:connection` (`orva_sso_connections`) — Phase 3
id, tenant_id, organization_id, name, issuer_url, client_id,
client_secret (**encrypted**), email_domains text[] (lowercase),
enabled bool, updated_at etc.

## API Contracts

| Method | Path | Gate | Input | Success | Errors |
|---|---|---|---|---|---|
| GET | `/api/orva_mfa/status` | staff auth | – | `{ enrolled, active, activatedAt }` | 401 |
| POST | `/api/orva_mfa/enroll` | staff auth + `orva_mfa.self` | `{}` | `{ secret, otpauthUrl }` (pending credential; re-enroll replaces pending) | 401, 409 active-exists |
| POST | `/api/orva_mfa/activate` | staff auth + `orva_mfa.self` | `{ code }` | `{ ok, recoveryCodes: string[8] }` | 400 bad code, 423 locked |
| POST | `/api/orva_mfa/disable` | staff auth + `orva_mfa.self` | `{ code }` (TOTP or recovery) | `{ ok }` | 400, 423 |
| POST | `/api/orva_mfa/verify` | **pending-audience token** in `auth_token` cookie | `{ code, remember? }` | `{ ok, redirect }` + full staff cookie set | 400 bad code, 401 no/expired challenge, 423 locked |
| GET | `/api/orva_sso/discover` | none (public; returns only boolean) | `?email=` | `{ sso: boolean }` | 400 |
| GET | `/api/orva_sso/start` | none | `?email&redirect` | 302 → IdP (state/nonce/PKCE cookies) | 404 no connection |
| GET | `/api/orva_sso/callback` | state cookie | `?code&state` | 302 → redirect with staff cookie | 400 state/nonce, 403 unknown user |
| CRUD | `/api/orva_sso/connections` | `orva_sso.manage` | makeCrudRoute | standard | standard |

All hand-written routes export per-method `metadata` + `openApi`. The verify
route is a session-issuing mutation; mutation-guard wiring is N/A (no CRUD
entity mutated) but rate limiting substitutes as the abuse control.

## UI and Interaction Contracts

| Surface | Purpose | Reference | Components |
|---|---|---|---|
| `/mfa` (frontend page, no auth guard) | challenge form: 6-digit code or recovery code, error + lockout states | core `/login` page styling | custom lightweight form (login-adjacent, pre-session so no backend shell) |
| `/backend/security/mfa` | self-service: status card, enroll (secret + otpauth URI + copy), activate code field, recovery codes display-once, disable | closest: settings pages | `Page`, `PageBody`, form primitives |
| `/backend/settings/sso` (Phase 3) | connections DataTable + CrudForm | orva_finance settings pages | `DataTable`, `CrudForm` |

States covered: loading/empty/error/locked/conflict; Thai + English i18n keys
`orva_mfa.*` / `orva_sso.*` in module `i18n/`.

## Security, Privacy, Compliance

- Pending token: TTL 300 s, audience `orva_mfa_pending`, carries
  `{ sub, tenantId, orgId, email, remember }`; cannot verify as staff.
- TOTP secret 20 random bytes (`crypto.randomBytes`), base32; encrypted at
  rest via module encryption map; never returned after enroll response.
- Recovery codes: 10-char base32 groups, stored `hashAuthToken`-hashed,
  single-use (set `used_at`), regenerating invalidates the old batch.
- Constant-time comparisons (`crypto.timingSafeEqual`) for code checks.
- Lockout + replay guard as in Data Models; all failures audit-logged via
  standard route logging.
- SSO: `state`/`nonce`/PKCE verifier in signed, httpOnly, 10-min cookies
  (pattern: core `communication_channels/lib/oauth-state.ts`, itself a public
  clean-room port); ID token signature via `jose` remote JWKS; `iss`, `aud`,
  `nonce`, `exp` all enforced; email accepted only when `email_verified`.

## Edge Cases & Failure Scenarios

- Pending token expires → /mfa verify returns 401; page links back to /login.
- User loses device → recovery code path in /mfa and in disable.
- All recovery codes used → user must contact admin (admin reset = future).
- Enrollment while a session is live elsewhere → old sessions lack flag+claim
  → middleware bounces them to /mfa (they hold a full token; verify accepts a
  staff-audience token bearing a valid sid as an alternative challenge input).
- Token refresh drops the `mfa` claim → middleware falls back to session-flag
  lookup; flag row keyed by sid survives refresh (same session row).
- Interceptor cannot see userId → resolves user by `body.email` +
  `body.tenantId` exactly as the login route did; on multiple tenant matches
  without tenantId, treats enrolled-if-any-active-credential (fail closed).
- SSO IdP down / bad JWKS → 502 message on callback, no partial session.

## Implementation Phases

### Phase 1 — orva_mfa core (entities + TOTP lib + enroll/activate/verify + gating)
- Deliverables: module scaffold, entities+migration (RLS), `lib/totp.ts` (+
  RFC vectors jest), encryption.ts, acl/setup, 5 API routes, login
  after-interceptor, `/mfa` frontend page, backend middleware, i18n th/en.
- Exit gate: enrolled user forced through /mfa end-to-end in the browser;
  non-enrolled login unaffected; pending token rejected on /backend and APIs;
  `yarn generate && yarn typecheck && yarn test` green.
### Phase 2 — self-service UI polish
- `/backend/security/mfa` page (status/enroll/activate/disable/recovery),
  sidebar entry under settings group, disable flow, lockout UX.
- Exit gate: full lifecycle via UI in Thai + English.
### Phase 3 — orva_sso (OIDC)
- Connection entity/CRUD/settings UI, discover/start/callback, login-form
  injection widget, issuance with `idp` claim, integration tests with a mock
  IdP (or Keycloak-in-docker deferred to test env).
- Exit gate: user of a configured domain signs in via IdP round-trip.

## Requirement Traceability

| REQ | Phase | Tests | Acceptance |
|---|---|---|---|
| REQ-001 | 1–2 | jest totp vectors; integration enroll→activate | AC-001 codes shown once, secret encrypted in DB |
| REQ-002 | 1 | browser flow; pending-token API probe 401 | AC-002 no privileged response pre-verify |
| REQ-003 | 2 | disable flow test | AC-003 |
| REQ-004 | 3 | mock-IdP callback test | AC-004 unknown email → 403 |

## Rollout & Rollback

Migrations additive-only (`select orva_apply_rls();` at end). Modules
registered in `src/modules.ts`; rollback = remove registrations (tables
retained). No upstream contract changes → upstream upgrades unaffected; watch
`auth/login` interceptor contract and `auth.login:form` context (`v1`) in
UPGRADE_NOTES on each bump.

## Changelog

| Date | Change |
|---|---|
| 2026-08-30 | Initial draft, autonomous defaults, status Ready (Q4 dep flagged) |
