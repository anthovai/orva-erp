import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { buildFeatureNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { withTenantRls } from '@/lib/rls'
import { notificationTypes } from '../notifications'
import { buildHomeOverview } from '../lib/homeOverviewData'
import { composeBrief } from '../lib/dailyBrief'
import th from '../i18n/th.json'

/**
 * One notification each weekday morning covering what nothing else announces:
 * filings coming due, clients waiting on a reply, licences lapsing, quotes
 * about to expire, and work accepted but not yet billed.
 *
 * Overdue invoices are deliberately absent — the reminder scan raises those
 * individually with amount and days, which beats a count.
 *
 * The figures come from `buildHomeOverview`, the same function behind the home
 * screen and the assistant's overview tool, so the brief cannot quietly
 * disagree with the screen the owner opens after reading it.
 */
const logger = createLogger('orva_finance').child({ component: 'daily-brief' })

export const metadata: WorkerMeta = {
  queue: 'orva_finance.daily_brief',
  id: 'orva_finance:daily-brief',
  concurrency: 1,
}

type BriefPayload = {
  scope?: { tenantId?: string; organizationId?: string }
  /** Override for tests; defaults to today. */
  today?: string
}

type HandlerContext = JobContext & {
  container?: { resolve: <T>(name: string) => T }
  resolve: <T>(name: string) => T
}

const OPEN_STATUSES = "'open','in_progress','waiting_customer'"

export default async function handle(job: QueuedJob<BriefPayload>, ctx: HandlerContext): Promise<void> {
  const tenantId = job.payload?.scope?.tenantId
  const organizationId = job.payload?.scope?.organizationId
  if (!tenantId || !organizationId) {
    logger.warn('Brief skipped: the schedule carries no tenant scope')
    return
  }
  const today = job.payload?.today ?? new Date().toISOString().slice(0, 10)
  const em = ctx.resolve<EntityManager>('em')
  const container = ctx.container ?? { resolve: ctx.resolve }

  try {
    const brief = await withTenantRls(em, tenantId, async (tem) => {
      const overview = await buildHomeOverview(tem, { tenantId, organizationId }, today)
      const [tickets] = (await tem.execute(
        `select
           count(*) filter (where first_response_at is null)::int as awaiting_reply,
           count(*) filter (where due_on is not null and due_on < ?::date)::int as overdue
         from orva_support_tickets
         where deleted_at is null and tenant_id = ?::uuid and organization_id = ?::uuid
           and status in (${OPEN_STATUSES})`,
        [today, tenantId, organizationId],
      )) as Array<{ awaiting_reply: number; overdue: number }>

      return composeBrief({
        tax: overview.tax.map((filing) => ({
          daysLeft: filing.daysLeft,
          packSentAt: filing.packSentAt,
          amount: filing.amount,
        })),
        ticketsAwaitingReply: Number(tickets?.awaiting_reply ?? 0),
        ticketsOverdue: Number(tickets?.overdue ?? 0),
        lapsedSubscriptions: overview.waiting.lapsedSubscriptions,
        renewingSubscriptions: overview.waiting.renewingSubscriptions,
        quotes: overview.waiting.quotes.map((quote) => ({ daysLeft: quote.daysLeft })),
        acceptedAwaitingInstallment: overview.waiting.acceptedAwaitingInstallment.length,
      })
    })

    if (!brief) {
      logger.info('Nothing worth a brief this morning', { tenantId, today })
      return
    }

    const typeDef = notificationTypes.find((type) => type.type === 'orva_finance.daily_brief')
    if (!typeDef) return

    // The notification builder takes an i18n key plus variables and offers no
    // free-text body, and a worker has no request to resolve a locale from. So
    // the category labels are read from this module's own Thai catalogue and
    // joined here, which keeps the wording in the translation files rather than
    // hard-coded in the worker, and lets the body carry only what is pending.
    const summary = brief.present
      .map((section) => {
        const label = th[`orva_finance.notifications.dailyBrief.section.${section.key}`] ?? section.key
        return `${label} ${section.count}`
      })
      .join(' · ')

    await resolveNotificationService(container).createForFeature(
      buildFeatureNotificationFromType(typeDef, {
        requiredFeature: 'orva_finance.gl.view',
        titleVariables: { total: String(brief.total) },
        bodyVariables: { summary },
        linkHref: '/backend',
        // One per day: a retry, or a second tick, must not send two briefs.
        groupKey: `orva_finance.daily_brief:${today}`,
      }),
      { tenantId, organizationId },
    )
    logger.info('Brief raised', { tenantId, today, total: brief.total, counts: brief.counts })
  } catch (error) {
    // A failed brief must be loud in the log: silence is otherwise
    // indistinguishable from a quiet morning.
    logger.error('Could not build the daily brief', {
      tenantId, today,
      err: error instanceof Error ? error.message : String(error),
    })
  }
}
