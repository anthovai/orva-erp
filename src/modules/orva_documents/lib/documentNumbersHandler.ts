import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { SalesDocumentNumberGenerator } from '@open-mercato/core/modules/sales/services/salesDocumentNumberGenerator'
import { z } from 'zod'
import { peekNextNumber } from './documentNumberPeek'

const bodySchema = z.object({
  kind: z.enum(['order', 'quote', 'invoice', 'credit_memo', 'return']),
  format: z.string().trim().min(1).max(120).optional(),
})

const KIND_FEATURE: Record<string, string> = {
  order: 'sales.orders.manage',
  quote: 'sales.quotes.manage',
  invoice: 'sales.invoices.manage',
  credit_memo: 'sales.credit_memos.manage',
  return: 'sales.orders.manage',
}

/**
 * Replacement for POST /api/sales/document-numbers (wired in src/modules.ts).
 * Same contract — { number, format, sequence } — with one behavioural change:
 * quote/order numbers are PREVIEWED, not claimed. The claim happens in the
 * create-command interceptors (commands/interceptors.ts) when the document is
 * actually saved. Invoice / credit-memo / return numbers, and any explicit
 * format request, still claim immediately (issue-invoice depends on that).
 * Authorization matches upstream: the kind's manage feature plus
 * sales.documents.number.edit, checked through the RBAC service.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth) ?? auth.orgId ?? null
  if (!organizationId) return Response.json({ error: 'Organization context is required' }, { status: 400 })
  const parsed = bodySchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const { kind, format } = parsed.data

  const container = await createRequestContainer()
  const rbac = container.resolve<RbacService | null>('rbacService')
  if (rbac && auth.sub) {
    const ok = await rbac.userHasAllFeatures(auth.sub, [KIND_FEATURE[kind] ?? 'sales.orders.manage', 'sales.documents.number.edit'], {
      tenantId: auth.tenantId,
      organizationId,
    })
    if (!ok) return Response.json({ error: 'You cannot generate document numbers.' }, { status: 403 })
  }

  const em = container.resolve<EntityManager>('em')
  if ((kind === 'quote' || kind === 'order') && !format) {
    const peek = await peekNextNumber(em, { tenantId: auth.tenantId, organizationId }, kind)
    if (peek) return Response.json(peek)
  }
  const generator = container.resolve<SalesDocumentNumberGenerator>('salesDocumentNumberGenerator')
  const result = await generator.generate({ kind, organizationId, tenantId: auth.tenantId, format: format ?? null })
  return Response.json({ number: result.number, format: result.format, sequence: result.sequence })
}
