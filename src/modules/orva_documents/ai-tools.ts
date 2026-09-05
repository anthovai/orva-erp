/**
 * Document/project tools for the assistant. Read-only: every document write
 * already has an owner-approved path (`orva_finance.send_payment_reminder`,
 * the issue-invoice dialog), so this pack only answers questions.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { AiToolDefinition, McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import { withTenantRls } from '@/lib/rls'
import { listProjects } from './lib/projects'

function requireScope(ctx: McpToolContext): { tenantId: string; organizationId: string | null } {
  if (!ctx.tenantId) throw new Error('Tenant context is required for orva_documents.* tools')
  return { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
}

const listProjectsInput = z.object({
  onlyUnbilled: z.boolean().optional().describe('Keep only projects with an amount still to invoice.'),
}).passthrough()

export const listProjectsTool: AiToolDefinition = {
  name: 'orva_documents.list_projects',
  displayName: 'ความคืบหน้าโปรเจกต์',
  description:
    'Every quotation as a project with its installment-billing progress: quote total, งวด issued, amount billed and paid, percentage of each, what is left to invoice, what is left to collect, unpaid installments, and open support tickets against it. This is how to answer "which project still owes us money" or "what should I bill next".',
  inputSchema: listProjectsInput,
  requiredFeatures: ['orva_documents.view'],
  tags: ['read', 'orva_documents', 'projects', 'sales'],
  handler: async (rawInput, ctx) => {
    const scope = requireScope(ctx)
    const input = listProjectsInput.parse(rawInput ?? {})
    const em = ctx.container.resolve<EntityManager>('em')
    return withTenantRls(em, scope.tenantId, async (tem) => {
      const rows = await listProjects(tem, scope)
      const items = rows
        .filter((row) => (input.onlyUnbilled ? row.remainingToBill > 0.005 : true))
        .map((row) => ({
          quoteNumber: row.quoteNumber,
          customer: row.customerName,
          currency: row.currencyCode,
          projectValue: row.quoteTotal.toFixed(2),
          installmentsIssued: row.installments,
          unpaidInstallments: row.unpaidInstallments,
          billed: row.billed.toFixed(2),
          paid: row.paid.toFixed(2),
          billedPct: row.billedPct,
          paidPct: row.paidPct,
          leftToBill: row.remainingToBill.toFixed(2),
          leftToCollect: row.remainingToCollect.toFixed(2),
          status: row.status,
          openTickets: row.openTickets,
          href: `/backend/sales/quotes/${row.quoteId}`,
        }))
      const sum = (pick: (r: (typeof rows)[number]) => number) =>
        rows.reduce((s, r) => s + pick(r), 0).toFixed(2)
      return {
        totals: {
          projects: items.length,
          value: sum((r) => r.quoteTotal),
          billed: sum((r) => r.billed),
          paid: sum((r) => r.paid),
          leftToBill: sum((r) => r.remainingToBill),
          leftToCollect: sum((r) => r.remainingToCollect),
        },
        items,
      }
    })
  },
}

export const aiTools: AiToolDefinition[] = [listProjectsTool]

export default aiTools
