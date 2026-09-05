/**
 * Support tool pack — the assistant reaches the customer-support queue and the
 * software register the same way the owner does on screen.
 *
 * Reads answer "what is waiting on me"; the two mutations (reply to a ticket,
 * mark a licence renewed) are `isMutation: true`, so the runtime turns each
 * call into a pending action the owner approves on a preview card — the
 * handler never runs before that approval. Writes go through the same API
 * routes the screens use (`createAiApiOperationRunner`), so RBAC, the status
 * machine and optimistic locking behave exactly as in the UI.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { createAiApiOperationRunner, type AiToolExecutionContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import type { AiToolDefinition, McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import { withTenantRls } from '@/lib/rls'
import { billableHours } from './lib/tickets'
import { annualisedCost, daysUntil, renewalState, summarise, type BillingCycle } from './lib/subscriptions'

type Scope = { tenantId: string; organizationId: string | null }

function requireScope(ctx: McpToolContext): Scope & { tenantId: string } {
  if (!ctx.tenantId) throw new Error('Tenant context is required for orva_support.* tools')
  return { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
}
const resolveEm = (ctx: McpToolContext) => ctx.container.resolve<EntityManager>('em')
const runner = (ctx: McpToolContext) => createAiApiOperationRunner(ctx as AiToolExecutionContext)
const isoToday = () => new Date().toISOString().slice(0, 10)

const OPEN_STATUSES = ['open', 'in_progress', 'waiting_customer'] as const

// ── orva_support.list_tickets ─────────────────────────────────────────────────

const listTicketsInput = z.object({
  onlyUnanswered: z.boolean().optional().describe('Keep only tickets we have never replied to.'),
  includeClosed: z.boolean().optional().describe('Include resolved and closed tickets. Defaults to open work only.'),
}).passthrough()

export const listTicketsTool: AiToolDefinition = {
  name: 'orva_support.list_tickets',
  displayName: 'เรื่องซัพพอร์ตที่ค้าง',
  description:
    'The customer support queue for software we shipped: ticket number, subject, kind (bug/question/change_request/incident), priority, status, customer, the project it belongs to, age in hours, whether we have answered yet, days overdue, and time logged. Sorted urgent and overdue first.',
  inputSchema: listTicketsInput,
  requiredFeatures: ['orva_support.view'],
  tags: ['read', 'orva_support', 'tickets'],
  handler: async (rawInput, ctx) => {
    const scope = requireScope(ctx)
    const input = listTicketsInput.parse(rawInput ?? {})
    const em = resolveEm(ctx)
    const today = isoToday()
    return withTenantRls(em, scope.tenantId, async (tem) => {
      const rows = (await tem.execute(
        `select t.ticket_no, t.subject, t.kind, t.priority, t.status, t.customer_name,
                t.due_on::text as due_on, t.minutes_spent, t.first_response_at is null as unanswered,
                round(extract(epoch from (now() - t.created_at)) / 3600.0, 1) as age_hours,
                q.quote_number as project
         from orva_support_tickets t
         left join sales_quotes q on q.id = t.quote_id and q.deleted_at is null
         where t.deleted_at is null and t.tenant_id = ?::uuid
           and (?::uuid is null or t.organization_id = ?::uuid)
           and (?::boolean is true or t.status = any(?::text[]))
         order by case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
                  t.due_on nulls last, t.created_at`,
        [
          scope.tenantId, scope.organizationId, scope.organizationId,
          input.includeClosed === true, `{${OPEN_STATUSES.join(',')}}`,
        ],
      )) as Array<{
        ticket_no: string; subject: string; kind: string; priority: string; status: string
        customer_name: string | null; due_on: string | null; minutes_spent: number
        unanswered: boolean; age_hours: string; project: string | null
      }>
      const items = rows
        .filter((row) => (input.onlyUnanswered ? row.unanswered : true))
        .map((row) => ({
          ticketNo: row.ticket_no,
          subject: row.subject,
          kind: row.kind,
          priority: row.priority,
          status: row.status,
          customer: row.customer_name,
          project: row.project,
          ageHours: Number(row.age_hours),
          awaitingOurReply: row.unanswered,
          daysOverdue: row.due_on ? Math.max(0, -daysUntil(row.due_on, today)) : 0,
          hoursLogged: billableHours(row.minutes_spent),
          href: '/backend/support/tickets',
        }))
      return {
        asOf: today,
        counts: {
          total: items.length,
          awaitingOurReply: items.filter((i) => i.awaitingOurReply).length,
          overdue: items.filter((i) => i.daysOverdue > 0).length,
          hoursLogged: Math.round(items.reduce((s, i) => s + i.hoursLogged, 0) * 100) / 100,
        },
        items,
      }
    })
  },
}

// ── orva_support.reply_ticket (mutation) ──────────────────────────────────────

const replyTicketInput = z.object({
  ticketId: z.string().uuid().describe('Ticket id. Resolve it from list_tickets if the owner gave a ticket number.'),
  body: z.string().trim().min(1).max(8000).describe('The reply text, in the language the customer wrote in.'),
  minutesSpent: z.coerce.number().int().min(0).max(10_000).optional().describe('Minutes to log against the ticket.'),
  status: z.enum(['open', 'in_progress', 'waiting_customer', 'resolved', 'closed']).optional()
    .describe('Move the ticket at the same time. Omit to keep the current status.'),
}).strict()

export const replyTicketTool: AiToolDefinition<z.infer<typeof replyTicketInput>> = {
  name: 'orva_support.reply_ticket',
  displayName: 'ตอบเรื่องซัพพอร์ต',
  description:
    'Adds a staff reply to a support ticket, optionally logging minutes and moving its status. Requires owner approval (pending action). The status machine still applies — an illegal transition is rejected.',
  inputSchema: replyTicketInput,
  requiredFeatures: ['orva_support.manage'],
  tags: ['write', 'orva_support', 'tickets'],
  isMutation: true,
  isDestructive: false,
  loadBeforeRecord: async (input) => ({
    recordId: input.ticketId,
    entityType: 'orva_support.ticket',
    recordVersion: null,
    before: { body: null, status: null },
    after: { body: input.body, status: input.status ?? null },
    display: { fieldLabels: { body: 'ข้อความตอบกลับ', status: 'สถานะ' } },
  }),
  handler: async (rawInput, ctx) => {
    requireScope(ctx)
    const input = replyTicketInput.parse(rawInput)
    const res = await runner(ctx).run<{ ok: boolean; status: string; minutesSpent: number }>({
      method: 'POST',
      path: '/orva_support/replies',
      body: {
        ticketId: input.ticketId,
        author: 'staff',
        body: input.body,
        minutesSpent: input.minutesSpent ?? 0,
        ...(input.status ? { status: input.status } : {}),
      },
    })
    if (!res.success || !res.data) throw new Error(res.error ?? 'Replying to the ticket failed')
    return { recordId: input.ticketId, commandName: 'orva_support.replies.create', status: res.data.status, minutesSpent: res.data.minutesSpent }
  },
}

// ── orva_support.list_renewals ────────────────────────────────────────────────

const listRenewalsInput = z.object({
  withinDays: z.coerce.number().int().min(0).max(365).optional()
    .describe('Only lines renewing within this many days (lapsed ones are always included). Defaults to 30.'),
}).passthrough()

export const listRenewalsTool: AiToolDefinition = {
  name: 'orva_support.list_renewals',
  displayName: 'ไลเซนส์ที่ใกล้ต่ออายุ',
  description:
    'Software licences, domains, hosting and certificates from the register, with days to renewal, whether they charge automatically, the cost per cycle and the yearly run-rate. Anything already lapsed is listed first — a lapsed domain takes a client site down.',
  inputSchema: listRenewalsInput,
  requiredFeatures: ['orva_support.view'],
  tags: ['read', 'orva_support', 'subscriptions'],
  handler: async (rawInput, ctx) => {
    const scope = requireScope(ctx)
    const input = listRenewalsInput.parse(rawInput ?? {})
    const within = input.withinDays ?? 30
    const today = isoToday()
    const em = resolveEm(ctx)
    return withTenantRls(em, scope.tenantId, async (tem) => {
      const rows = (await tem.execute(
        `select id::text, name, vendor, kind, cost::text, currency_code, billing_cycle,
                to_char(renews_on, 'YYYY-MM-DD') as renews_on, auto_renew, status
         from orva_support_subscriptions
         where deleted_at is null and tenant_id = ?::uuid
           and (?::uuid is null or organization_id = ?::uuid)
         order by renews_on asc nulls last, name`,
        [scope.tenantId, scope.organizationId, scope.organizationId],
      )) as Array<{
        id: string; name: string; vendor: string | null; kind: string; cost: string
        currency_code: string; billing_cycle: string; renews_on: string | null
        auto_renew: boolean; status: string
      }>
      const totals = summarise(
        rows.map((r) => ({ renewsOn: r.renews_on, cycle: r.billing_cycle as BillingCycle, cost: Number(r.cost), status: r.status })),
        today,
      )
      const items = rows
        .filter((r) => r.status === 'active' && r.renews_on != null)
        .map((r) => ({
          subscriptionId: r.id,
          name: r.name,
          vendor: r.vendor,
          kind: r.kind,
          renewsOn: r.renews_on,
          daysLeft: daysUntil(r.renews_on!, today),
          state: renewalState(r.renews_on!, today),
          chargesAutomatically: r.auto_renew,
          cost: Number(r.cost).toFixed(2),
          currency: r.currency_code,
          cycle: r.billing_cycle,
          costPerYear: annualisedCost(Number(r.cost), r.billing_cycle as BillingCycle).toFixed(2),
        }))
        .filter((r) => r.daysLeft < 0 || r.daysLeft <= within)
      return {
        asOf: today,
        counts: { lapsed: totals.lapsed, dueSoon: totals.dueSoon, costPerYear: totals.annualTotal.toFixed(2) },
        items,
        href: '/backend/support/subscriptions',
      }
    })
  },
}

// ── orva_support.mark_renewed (mutation) ──────────────────────────────────────

const markRenewedInput = z.object({
  subscriptionId: z.string().uuid().describe('From list_renewals.'),
  updatedAt: z.string().min(1).describe('The row version as read, for the optimistic lock.'),
}).strict()

export const markRenewedTool: AiToolDefinition<z.infer<typeof markRenewedInput>> = {
  name: 'orva_support.mark_renewed',
  displayName: 'บันทึกว่าต่ออายุแล้ว',
  description:
    'Rolls a licence forward one billing cycle after it has been paid, past today if it had lapsed. Requires owner approval (pending action). It records payment already made; it does not pay anything.',
  inputSchema: markRenewedInput,
  requiredFeatures: ['orva_support.manage'],
  tags: ['write', 'orva_support', 'subscriptions'],
  isMutation: true,
  isDestructive: false,
  loadBeforeRecord: async (input) => ({
    recordId: input.subscriptionId,
    entityType: 'orva_support.subscription',
    recordVersion: input.updatedAt,
    before: { renewed: null },
    after: { renewed: 'ต่ออายุแล้ว — เลื่อนวันครบกำหนดไปอีกหนึ่งรอบ' },
    display: { fieldLabels: { renewed: 'การต่ออายุ' } },
  }),
  handler: async (rawInput, ctx) => {
    requireScope(ctx)
    const input = markRenewedInput.parse(rawInput)
    const res = await runner(ctx).run<{ ok: boolean; renewsOn: string | null; status: string }>({
      method: 'PUT',
      path: '/orva_support/subscriptions',
      body: { id: input.subscriptionId, markRenewed: true, updatedAt: input.updatedAt },
    })
    if (!res.success || !res.data) throw new Error(res.error ?? 'Marking the renewal failed')
    return { recordId: input.subscriptionId, commandName: 'orva_support.subscriptions.update', renewsOn: res.data.renewsOn }
  },
}

export const aiTools: AiToolDefinition[] = [
  listTicketsTool,
  replyTicketTool as AiToolDefinition,
  listRenewalsTool,
  markRenewedTool as AiToolDefinition,
]

export default aiTools
