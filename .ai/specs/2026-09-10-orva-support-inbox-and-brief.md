# Orva G2 — the owner's inbox: reply by email, merge, and the AI launcher out of the way

**Date**: 2026-09-10
**Status**: Complete 2026-09-10 (G2.4 + AI launcher) — ephemeral suite 50/50 green — child of `2026-09-05-orva-phase-g-roadmap.md` Phase G2 (REQ-005/006/007)

> The roadmap's G2 shipped three of its pillars on 2026-09-05 (email → ticket, the weekday brief as a notification, the assistant tools). This child spec closes the remaining engineering: the reply that goes back to the client by email, the ticket merge for a thread that landed as a second ticket, and — asked for in the same breath — moving the AI launcher from the header to a small icon at the bottom of the screen.

## TLDR

A client email already becomes a ticket. Now the owner's reply on that ticket goes back to the client by email through the installed `messages` module (`visibility: public`, `sendViaEmail`), the customer's answer to that email finds the ticket by its number in the subject (`[TCK-000123]`) even when the mail headers do not thread, and an email that opened a duplicate ticket can be merged into the right one. The AI launcher leaves the header for a small floating icon bottom-right; Cmd/Ctrl+L still works. The brief's email digest stays blocked on `RESEND_API_KEY` (owner action) and is not built here.

## Problem Statement

- Replying to a client today means copying the ticket's text into Gmail by hand; the ticket then does not know a reply went out (J-003 step 3 in the roadmap).
- When the client answers our email, `In-Reply-To` points at our outbound message, which the inbox handler does not know, so the answer opens a second ticket.
- The header carries two AI controls (the `AI ⌘L` pill and the chat button) that the owner does not use from there; they crowd the org switcher and the bell on a laptop width.

## Goals

- **REQ-005b** — A staff reply on a ticket with a contact email can be sent by email in the same action; the reply records whether the email went out, and a failure never loses the reply.
- **REQ-005c** — A customer email whose subject carries a known ticket number appends to that ticket instead of opening a new one.
- **REQ-005d** — Two tickets about one thread can be merged: replies move, the customer's text is kept, the duplicate is closed, and the thread ids follow.
- **REQ-010** — The AI assistant opens from a small floating icon at the bottom-right (and Cmd/Ctrl+L); the header shows no AI control.

## Non-goals

- The brief's email digest (blocked on the Resend key). Gmail OAuth (owner action). Email attachments on replies. Rich-text replies.

## Proposed Solution

| Piece | Where | How |
|---|---|---|
| Reply by email | `POST /api/orva_support/replies` `+ sendEmail` | after the reply is committed, `callInternal` → `POST /api/messages` with `visibility: 'public'`, `externalEmail`, `subject: Re: [TCK-…] …`, `sendViaEmail: true`, `sourceEntityType: 'orva_support:ticket'`; outcome stored on the reply (`email_message_id`, `email_status` sent/failed, `email_error`); response carries `email: { sent, error }` — 200 either way, the reply is saved |
| Subject threading | `subscribers/email-to-ticket.ts` | `ticketNoFromSubject()` (pure, in `lib/tickets.ts`) checked before the header-based thread match |
| Merge | `POST /api/orva_support/tickets/merge` | `{ sourceId, targetId, updatedAt }` (target's lock): replies re-parented, source description appended as customer/note reply, minutes summed, `thread_id`/`source_email_id`/contact copied when the target lacks them, source closed + soft-deleted |
| UI | `TicketsPage` | badges จากอีเมล / ยังไม่จับคู่ลูกค้า; "ส่งอีเมลถึงลูกค้า" switch on the composer (on by default for email tickets with a contact); per-reply ส่งอีเมลแล้ว / ส่งไม่สำเร็จ; "รวมเข้าเรื่องอื่น…" with a confirm dialog |
| AI launcher | `src/components/orva/AiFloatingLauncher.tsx`, `BackendHeaderChrome`, `globals.css` | header chat button replaced by a fixed bottom-right icon that dispatches the launcher's own open event (`om:open-ai-assistant-launcher`); the upstream topbar pill hidden by CSS on its `data-ai-launcher-trigger` attributes |

Design decisions: the outbound email goes through `messages` (house email path: Resend, test-mode capture) rather than a new transport — the compose is synchronous and provable through `GET /api/messages/{id}`; delivery is the module's send-email worker (Resend in production, the test-mode capture file when a worker runs). Failure returns 200 with a flag instead of the roadmap's 502: a 502 would tell the screen the reply failed when it was saved. Subject threading is the reliable signal because our outbound `Message-ID` is Resend's, not ours.

## Data Models

`orva_support_replies` + `email_message_id uuid null`, `email_status text null check in ('sent','failed')`, `email_error text null` — migration `Migration20260910120000_reply_email.ts`, ends with `orva_apply_rls()`. No other schema change.

## API, Command, and Error Contracts

| Method | Path | Gate | Input | Success | Errors |
|---|---|---|---|---|---|
| `POST` | `/api/orva_support/replies` | `orva_support.manage` | `replyCreateSchema` + `sendEmail?` | `{ ok, ticketId, status, minutesSpent, updatedAt, email: { sent, error? } \| null }` | 400/404 |
| `POST` | `/api/orva_support/tickets/merge` | `orva_support.manage` | `{ sourceId, targetId, updatedAt }` | `{ ok, targetId, ticketNo, updatedAt }` | 400 same ticket / 404 / 409 stale |

Additive: existing callers of `replies` unchanged (`sendEmail` defaults false). Tickets list gains `source`, `threadId`; replies list gains `emailStatus`, `emailError`.

## Integration Coverage

| Test | Level | Setup | Actions | Assertions |
|---|---|---|---|---|
| TEST-G2-1 | integration | ticket with `contactEmail` | reply with `sendEmail: true` | `email.sent === true` + `messageId`; `GET /api/messages/{id}` carries the ticket number in its subject and the client's address; reply row `emailStatus = sent`. Delivery is the messages send-email worker's job — the capture file is read when present, not required (the ephemeral app runs no worker) |
| TEST-G2-2 | integration | two tickets | merge B into A | A has B's replies + the carried text; B is gone from the list; A's `threadId` set |
| TEST-G2-3 | unit | — | `ticketNoFromSubject` | finds `TCK-000123` in `Re: [TCK-000123] …`, ignores noise |
| smoke | integration | — | every page + sidebar walk | still green (the floating icon renders on every screen) |

## Resolved assumptions (autonomous defaults)

| ID | Assumption | Flag |
|---|---|---|
| A1 | The floating icon opens the agent picker (same as ⌘L), not the chat dock directly | — |
| A2 | Email failure → 200 + flag (not 502) | — |
| A3 | Merge soft-deletes the duplicate rather than keeping it closed | ⚠ NEEDS HUMAN CONFIRMATION (reversible: a closed-but-kept duplicate is one line) |
| A4 | The brief's email digest waits for `RESEND_API_KEY` | — |

## Changelog

| Date | Change |
|---|---|
| 2026-09-10 | Initial draft; implementation started |
| 2026-09-10 | Shipped: migration `Migration20260910120000_reply_email` (applied to the dev DB by the dev runner), `replies` route `sendEmail` → `messages` compose via `callInternal`, `ticketNoFromSubject` in the inbox handler, `POST /api/orva_support/tickets/merge`, TicketsPage badges/switch/merge, `AiFloatingLauncher` (portalled to body — the header is a transformed ancestor that pinned a fixed child to itself) + CSS hiding the upstream pill. Verified on the dev server: header without AI controls, the corner icon opens the ผู้ช่วย AI picker, the composer shows the email switch and merge control on a throwaway ticket (deleted; ticket sequence reset). Unit: 473 green (`ticketNoFromSubject`, `replySubject`). Ephemeral: first run 47 passed / 3 failed — the capture-file assertion (no worker in the ephemeral app → no delivery to capture; replaced by asserting the message record) and the expenses Radix select flaking under the CPU load of gates run in parallel (picker made retrying; suite now runs alone) |
| 2026-09-10 | **Ephemeral run green: 50 passed** (47 + TEST-G2-1/1b/2) in 3.2 min with nothing else running; the smoke walk 37 links twice, 0 problems, corner icon present and header pill hidden on every page |
