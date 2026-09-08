import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { buildFeatureNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { withTenantRls } from '@/lib/rls'
import { notificationTypes } from '../notifications'
import { purchasingSummary } from '../lib/summary'
import { lateLinesToNotify } from '../lib/lateScan'

/**
 * Daily sweep for goods that were promised and have not arrived.
 *
 * Raises notifications and contacts nobody: which vendor to chase, and how, is
 * a relationship decision. What this adds over the home screen's live list is
 * persistence — the card only speaks when the page is open.
 *
 * Idempotent by construction: the group key is per line per day, so a retry, a
 * second tick or a manual `mercato scheduler run` cannot nag twice. The cadence
 * in `lib/lateScan.ts` keeps a line that has been late for a month from
 * producing thirty badges.
 */
const logger = createLogger('orva_purchasing').child({ component: 'late-scan' })

export const metadata: WorkerMeta = {
  queue: 'orva_purchasing.late_scan',
  id: 'orva_purchasing:late-scan',
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
    logger.warn('Scan skipped: the schedule carries no tenant scope')
    return
  }
  const container = ctx.container ?? ctx
  const em = container.resolve<EntityManager>('em')
  const today = job.payload?.today ?? new Date().toISOString().slice(0, 10)
  const scope = { tenantId, organizationId }

  const summary = await withTenantRls(em, tenantId, (tem) => purchasingSummary(tem, scope, today))
  const due = lateLinesToNotify(summary.lateLines, today)
  if (due.length === 0) {
    logger.info('Late scan finished', { tenantId, today, late: summary.lateLines.length, raised: 0 })
    return
  }

  const typeDef = notificationTypes.find((candidate) => candidate.type === 'orva_purchasing.line_late')
  if (!typeDef) return
  const service = resolveNotificationService(container)
  let raised = 0
  for (const item of due) {
    try {
      await service.createForFeature(
        buildFeatureNotificationFromType(typeDef, {
          requiredFeature: 'orva_purchasing.view',
          bodyVariables: item.bodyVariables,
          sourceEntityType: 'orva_purchasing:purchase_order',
          sourceEntityId: item.line.orderId,
          linkHref: `/backend/purchasing/orders/${item.line.orderId}`,
          groupKey: item.groupKey,
        }),
        { tenantId, organizationId },
      )
      raised += 1
    } catch (error) {
      // One notification failing must not abandon the rest of the sweep.
      logger.warn('Could not raise a late-delivery notification', {
        lineId: item.line.lineId,
        error: error instanceof Error ? error.message : error,
      })
    }
  }
  logger.info('Late scan finished', { tenantId, today, late: summary.lateLines.length, raised })
}
