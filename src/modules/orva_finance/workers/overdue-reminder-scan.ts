import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { buildFeatureNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { withTenantRls } from '@/lib/rls'
import { notificationTypes } from '../notifications'
import { invoicesDueForReminder, type ScanInvoice } from '../lib/overdueScan'

/**
 * Daily sweep for invoices that have gone quiet: it raises a notification and
 * sends nothing. Chasing a client is a judgement call, so the owner still
 * presses send (or asks the assistant, whose reminder tool is approval-gated).
 *
 * What this adds over the home screen's live list is persistence: the home
 * card only speaks when the home page is open, whereas a notification waits
 * with an unread badge wherever the owner happens to be.
 *
 * Idempotent by construction — the group key is per invoice per day, so a
 * re-run, a retry or a second tick cannot nag twice for the same invoice.
 */
const logger = createLogger('orva_finance').child({ component: 'overdue-reminder-scan' })

export const metadata: WorkerMeta = {
  queue: 'orva_finance.overdue_reminder_scan',
  id: 'orva_finance:overdue-reminder-scan',
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

type Row = {
  id: string
  invoice_number: string
  customer_name: string | null
  remaining: string
  due_date: string | null
  reminder_dates: string[] | null
}

export default async function handle(job: QueuedJob<ScanPayload>, ctx: HandlerContext): Promise<void> {
  const tenantId = job.payload?.scope?.tenantId
  const organizationId = job.payload?.scope?.organizationId
  if (!tenantId || !organizationId) {
    logger.warn('Scan skipped: the schedule carries no tenant scope')
    return
  }
  const today = job.payload?.today ?? new Date().toISOString().slice(0, 10)
  const em = ctx.resolve<EntityManager>('em')
  const container = ctx.container ?? { resolve: ctx.resolve }

  const hits = await withTenantRls(em, tenantId, async (tem) => {
    // Send history lives in orva_documents_sends; an invoice or its tax
    // invoice going out IS the nudge, because the owner sends the document
    // rather than a separate letter. Customer names come from the snapshot
    // only — customer_entities.display_name is encrypted and must never be
    // read through raw SQL.
    const rows = (await tem.execute(
      `select i.id::text, i.invoice_number,
              coalesce(i.metadata->'customerSnapshot'->'customer'->>'displayName',
                       i.metadata->'customerSnapshot'->>'displayName') as customer_name,
              (i.grand_total_gross_amount - coalesce(i.paid_total_amount, 0))::text as remaining,
              to_char(i.due_date, 'YYYY-MM-DD') as due_date,
              array(
                select to_char(s.sent_at, 'YYYY-MM-DD')
                from orva_documents_sends s
                where s.tenant_id = i.tenant_id and s.document_id = i.id
                  and s.document_type in ('invoice', 'tax_invoice', 'billing_note')
                order by s.sent_at
              ) as reminder_dates
       from sales_invoices i
       where i.deleted_at is null and i.tenant_id = ?::uuid and i.organization_id = ?::uuid
         and coalesce(i.status, '') not in ('cancelled', 'void', 'draft')
         and i.grand_total_gross_amount - coalesce(i.paid_total_amount, 0) > 0.005
         and i.due_date is not null`,
      [tenantId, organizationId],
    )) as Row[]

    const invoices: ScanInvoice[] = rows.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoice_number,
      customerName: row.customer_name,
      remaining: Number(row.remaining),
      dueDate: row.due_date,
      reminderDates: row.reminder_dates ?? [],
    }))
    return invoicesDueForReminder(invoices, today)
  })

  if (!hits.length) {
    logger.info('Overdue scan found nothing to chase', { tenantId, today })
    return
  }

  const typeDef = notificationTypes.find((type) => type.type === 'orva_finance.invoice.reminder_due')
  if (!typeDef) return
  const notificationService = resolveNotificationService(container)

  let raised = 0
  for (const hit of hits) {
    try {
      await notificationService.createForFeature(
        buildFeatureNotificationFromType(typeDef, {
          // Whoever is responsible for receivables, rather than one named
          // user: the owner today, an assistant later, with no code change.
          requiredFeature: 'orva_finance.ar.view',
          bodyVariables: {
            invoiceNumber: hit.invoiceNumber,
            customer: hit.customerName ?? '',
            amount: hit.remaining.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            days: String(hit.state.daysOverdue),
          },
          sourceEntityType: 'sales:invoice',
          sourceEntityId: hit.id,
          linkHref: `/backend/sales/invoices/${hit.id}`,
          groupKey: hit.groupKey,
        }),
        { tenantId, organizationId },
      )
      raised += 1
    } catch (err) {
      // One bad row must not cost the rest of the sweep.
      logger.warn('Could not raise a reminder notification', { invoiceId: hit.id, err })
    }
  }
  logger.info('Overdue scan finished', { tenantId, today, due: hits.length, raised })
}
