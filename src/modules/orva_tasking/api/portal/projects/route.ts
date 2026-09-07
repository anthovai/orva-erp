import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { isResponse, resolvePortalScope } from '../../../lib/portalScope'

// The route does its own customer authentication; staff auth does not apply.
export const metadata = {
  GET: { requireAuth: false },
}

const portalProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  total: z.number(),
  done: z.number(),
  percent: z.number(),
  overdue: z.number(),
  dueSoon: z.number(),
  nextDue: z.string().nullable(),
  quoteNumber: z.string().nullable(),
})

type Row = {
  id: string; name: string; quote_number: string | null
  total: number; done: number; overdue: number; due_soon: number; next_due: string | null
}

/**
 * The customer's own work, summarised.
 *
 * One place covering every project the business chose to show them, which is
 * what the KKG-Tasking overview link does today — except the scope is the
 * signed-in account rather than possession of a URL, so there is no link to
 * leak and nothing to revoke.
 *
 * The scoping predicate lives inside the SQL, not in application code after
 * the fact: published project → its quotation → that quotation's customer
 * must be this customer. Three conditions, one WHERE clause, no way to forget
 * one.
 */
export async function GET(req: Request) {
  const scope = await resolvePortalScope(req)
  if (isResponse(scope)) return scope

  const today = new Date().toISOString().slice(0, 10)

  const items = await withTenantRls(scope.em, scope.tenantId, async (tem) => {
    const rows = (await tem.execute(
      `select p.id::text,
              coalesce(nullif(p.customer_label, ''), p.name) as name,
              q.quote_number,
              count(t.id)::int as total,
              count(t.id) filter (where t.done)::int as done,
              count(t.id) filter (where not t.done and t.due_on is not null and t.due_on < ?::date)::int as overdue,
              count(t.id) filter (where not t.done and t.due_on is not null
                                    and t.due_on >= ?::date and t.due_on <= (?::date + 7))::int as due_soon,
              to_char(min(t.due_on) filter (where not t.done and t.due_on >= ?::date), 'YYYY-MM-DD') as next_due
       from orva_tasking_projects p
       join sales_quotes q
         on q.id = p.quote_id and q.deleted_at is null
        and q.tenant_id = p.tenant_id
        and q.customer_entity_id = ?::uuid
       left join orva_tasking_tasks t
         on t.project_id = p.id and t.deleted_at is null and t.customer_visible
       where p.deleted_at is null
         and p.tenant_id = ?::uuid and p.organization_id = ?::uuid
         and p.customer_visible
         and not p.is_archived
       group by p.id, q.quote_number
       order by p.position, p.created_at`,
      [today, today, today, today, scope.customerEntityId, scope.tenantId, scope.organizationId],
    )) as Row[]

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      total: row.total,
      done: row.done,
      // Rounded to whole numbers here: a customer reading progress does not
      // need a decimal, and 66.7% invites a question the number cannot answer.
      percent: row.total > 0 ? Math.round((row.done / row.total) * 100) : 0,
      overdue: row.overdue,
      dueSoon: row.due_soon,
      nextDue: row.next_due,
      quoteNumber: row.quote_number,
    }))
  })

  return Response.json({ items })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Tasking',
  summary: 'Portal: my projects',
  methods: {
    GET: {
      summary: "A customer's published projects with progress, overdue and next due date",
      tags: ['Orva Tasking'],
      responses: [{ status: 200, description: 'Projects.', schema: z.object({ items: z.array(portalProjectSchema) }) }],
      errors: [
        { status: 401, description: 'Not signed in to the portal', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'The account is not linked to a customer, or lacks the portal feature', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
