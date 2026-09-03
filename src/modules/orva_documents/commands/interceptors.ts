import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandInterceptor } from '@open-mercato/shared/lib/commands/command-interceptor'
import type { SalesDocumentNumberGenerator } from '@open-mercato/core/modules/sales/services/salesDocumentNumberGenerator'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { peekNextNumber, type PeekKind } from '../lib/documentNumberPeek'

const logger = createLogger('orva_documents').child({ interceptor: 'document-numbers' })

/**
 * The other half of the non-burning number series (see
 * lib/documentNumberPeek.ts): the create screen only PREVIEWED the number, so
 * the real claim happens here, at save time.
 *
 * If the submitted number is one of the previewed values (for either kind —
 * the upstream form keeps the quote preview when the user switches to
 * "order"), it is replaced by a freshly claimed number of the RIGHT kind.
 * A hand-typed number is left alone. Concurrency is safe: the claim is the
 * generator's atomic upsert, so two users previewing the same number get
 * consecutive real ones.
 */
function makeInterceptor(kind: PeekKind, field: 'quoteNumber' | 'orderNumber'): CommandInterceptor {
  return {
    id: `orva_documents.${kind}-number-claim`,
    targetCommand: kind === 'quote' ? 'sales.quotes.create' : 'sales.orders.create',
    priority: 40,
    async beforeExecute(input, context) {
      const record = (input ?? {}) as Record<string, unknown>
      const tenantId = context.auth?.tenantId ?? (typeof record.tenantId === 'string' ? record.tenantId : null)
      const organizationId =
        context.selectedOrganizationId ?? context.auth?.orgId ?? (typeof record.organizationId === 'string' ? record.organizationId : null)
      if (!tenantId || !organizationId) return { ok: true }
      const submitted = typeof record[field] === 'string' ? (record[field] as string).trim() : ''
      try {
        const em = context.container.resolve<EntityManager>('em')
        const scope = { tenantId, organizationId }
        const [quotePeek, orderPeek] = await Promise.all([
          peekNextNumber(em, scope, 'quote'),
          peekNextNumber(em, scope, 'order'),
        ])
        const previewed = new Set([quotePeek?.number, orderPeek?.number].filter(Boolean))
        if (submitted && !previewed.has(submitted)) return { ok: true } // custom number: respect it
        const generator = context.container.resolve<SalesDocumentNumberGenerator>('salesDocumentNumberGenerator')
        const claimed = await generator.generate({ kind, organizationId, tenantId, format: null })
        return { ok: true, modifiedInput: { [field]: claimed.number } }
      } catch (err) {
        // never block a save over numbering — the command still allocates when the field is blank
        logger.error('document number claim failed; leaving input untouched', { kind, err: err instanceof Error ? err.message : String(err) })
        return { ok: true }
      }
    },
  }
}

export const interceptors: CommandInterceptor[] = [
  makeInterceptor('quote', 'quoteNumber'),
  makeInterceptor('order', 'orderNumber'),
]
