import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { buildFeatureNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { withTenantRls } from '@/lib/rls'
import { SupportSubscription } from '../data/entities'
import { notificationTypes } from '../notifications'
import { retainerGroupKey, retainersDue, type RetainerLike } from '../lib/retainers'
import type { BillingCycle } from '../lib/subscriptions'

/**
 * Daily sweep for retainers whose cycle has come round. It raises a
 * notification and issues nothing.
 *
 * Spec A8 flagged an unattended invoice as a policy decision the owner has
 * to make, so this follows the overdue-reminder precedent in orva_finance:
 * the scan finds the work, the owner presses ออกใบแจ้งหนี้ on the register,
 * and the invoice is minted with their own session. Turning that into
 * automatic issuing later is a change to this file and nothing else.
 *
 * Idempotent by construction — the group key is per retainer per renewal
 * date, so a re-run, a retry or a second tick cannot nag twice.
 */
const logger = createLogger('orva_support').child({ component: 'retainer-scan' })

export const metadata: WorkerMeta = {
  queue: 'orva_support.retainer_scan',
  id: 'orva_support:retainer-scan',
  concurrency: 1,
}

type ScanPayload = {
  scope?: { tenantId?: string; organizationId?: string }
  /** Override for tests and for `mercato scheduler run`; defaults to today. */
  today?: string
}

type HandlerContext = JobContext & {
  container?: { resolve: <T>(name: string) => T }
  resolve: <T>(name: string) => T
}

export default async function handle(job: QueuedJob<ScanPayload>, ctx: HandlerContext): Promise<void> {
  const tenantId = job.payload?.scope?.tenantId
  const organizationId = job.payload?.scope?.organizationId
  if (!tenantId || !organizationId) {
    logger.warn('Retainer scan skipped: the schedule carries no tenant scope')
    return
  }
  const today = job.payload?.today ?? new Date().toISOString().slice(0, 10)
  const em = ctx.resolve<EntityManager>('em')
  const container = ctx.container ?? { resolve: ctx.resolve }

  const due = await withTenantRls(em, tenantId, async (tem) => {
    const rows = await tem.find(SupportSubscription, {
      tenantId, organizationId, deletedAt: null, invoiceOnRenewal: true, status: 'active',
    })
    const lines: RetainerLike[] = rows.map((row) => ({
      id: row.id, name: row.name, status: row.status, invoiceOnRenewal: row.invoiceOnRenewal,
      renewsOn: row.renewsOn ?? null, billingCycle: row.billingCycle as BillingCycle,
      customerEntityId: row.customerEntityId ?? null, quoteId: row.quoteId ?? null,
      retainerAmount: row.retainerAmount == null ? null : Number(row.retainerAmount),
      cost: Number(row.cost ?? 0),
      lastInvoicedOn: row.lastInvoicedAt ? row.lastInvoicedAt.toISOString().slice(0, 10) : null,
    }))
    return retainersDue(lines, today).map((hit) => ({
      ...hit,
      customerName: rows.find((row) => row.id === hit.row.id)?.customerName ?? null,
    }))
  })

  if (!due.length) {
    logger.info('Retainer scan found nothing due', { tenantId, today })
    return
  }

  const typeDef = notificationTypes.find((type) => type.type === 'orva_support.retainer.due')
  if (!typeDef) return
  const notificationService = resolveNotificationService(container)

  let raised = 0
  for (const hit of due) {
    try {
      await notificationService.createForFeature(
        buildFeatureNotificationFromType(typeDef, {
          requiredFeature: 'orva_support.manage',
          bodyVariables: {
            name: hit.row.name,
            customer: hit.customerName ?? '',
            amount: hit.amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            date: hit.row.renewsOn ?? today,
          },
          sourceEntityType: 'orva_support:subscription',
          sourceEntityId: hit.row.id,
          linkHref: '/backend/support/subscriptions?bucket=retainers',
          groupKey: retainerGroupKey(hit.row.id, hit.row.renewsOn ?? today),
        }),
        { tenantId, organizationId },
      )
      raised += 1
    } catch (err) {
      // One bad row must not cost the rest of the sweep.
      logger.warn('Could not raise a retainer notification', { subscriptionId: hit.row.id, err })
    }
  }
  logger.info('Retainer scan finished', { tenantId, today, due: due.length, raised })
}
