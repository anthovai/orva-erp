---
title: "Upstream's sales create form claims a document number on open — preview instead, claim on save"
modules: ["orva_documents", "sales"]
areas: ["umes", "debugging"]
topics: ["document-numbers", "route-override", "command-interceptor"]
---

# Upstream's sales create form claims a document number on open — preview instead, claim on save

**Context**: `/backend/sales/documents/create` POSTs `/api/sales/document-numbers` as soon as it
mounts, and that route calls `generator.generate()`, which increments `sales_document_sequences`.
Every abandoned form burned a quote number (the counter drifted 11 → 27 in a day). Switching the
type toggle to "order" also kept the quote preview in the field, so orders saved with QTN numbers.

**Problem**: Thai bookkeeping wants continuous series, and the number field is inside an upstream
component that cannot be patched. The custom route has no interceptor bridge, so a plain API
interceptor cannot change it either.

**Rule**: Use the two sanctioned seams together: (1) `overrides.routes.api` in `src/modules.ts`
replaces `POST /api/sales/document-numbers` with a handler that PREVIEWS quote/order numbers
(`lib/documentNumberPeek.ts`, same `{number, format, sequence}` contract; invoice/credit-memo and
explicit-format requests still claim); (2) command interceptors on `sales.quotes.create` /
`sales.orders.create` (`orva_documents/commands/interceptors.ts`) claim the real number at save
when the submitted number equals either kind's preview, replacing it with the right series;
hand-typed numbers pass through. Keep the override's dynamic import so `modules.ts` stays free of
server-only code.

**Applies to**: `src/modules.ts` sales entry, `src/modules/orva_documents/lib/documentNumber*.ts`,
`src/modules/orva_documents/commands/interceptors.ts`; any future form that pre-allocates a number.
