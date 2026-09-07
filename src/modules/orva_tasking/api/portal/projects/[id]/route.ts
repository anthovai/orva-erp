import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { isResponse, resolvePortalScope } from '../../../../lib/portalScope'
import { portalProjectSchema as portalProjectParams } from '../../../../data/validators'

export const metadata = {
  GET: { requireAuth: false },
}

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
  doneAt: z.string().nullable(),
  dueOn: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  percentDone: z.number(),
  daysOverdue: z.number(),
  labels: z.array(z.object({ title: z.string(), hexColor: z.string() })),
})

const commentSchema = z.object({
  id: z.string(),
  body: z.string(),
  fromCustomer: z.boolean(),
  createdAt: z.string(),
})

const fileSchema = z.object({ id: z.string(), taskId: z.string() })

const installmentSchema = z.object({
  number: z.string(),
  dueDate: z.string().nullable(),
  total: z.string(),
  status: z.string(),
})

type TaskRow = {
  id: string; title: string; done: boolean; done_at: string | null
  due_on: string | null; start_date: string | null; end_date: string | null
  percent_done: number
  labels: { title: string; hexColor: string }[] | null
}

const daysBetween = (from: string, to: string) => {
  const u = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
  return Math.round((u(to) - u(from)) / 864e5)
}

/**
 * One project, as its customer sees it: the work, the conversation, the files,
 * and the money beside them.
 *
 * The money is the reason this is a portal page and not an anonymous link. A
 * token cannot be tied to a customer, so it can never show that customer their
 * own quotation and งวด; a signed-in account can.
 *
 * Anything outside the caller's scope answers **404, not 403** — a 403 would
 * confirm the project exists.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const scope = await resolvePortalScope(req)
  if (isResponse(scope)) return scope

  const parsed = portalProjectParams.safeParse(await ctx.params)
  if (!parsed.success) return Response.json({ error: 'Not found' }, { status: 404 })
  const projectId = parsed.data.id
  const today = new Date().toISOString().slice(0, 10)

  const payload = await withTenantRls(scope.em, scope.tenantId, async (tem) => {
    // The same three conditions as the list, plus the id. A project that fails
    // any of them simply does not exist for this caller.
    const [project] = (await tem.execute(
      `select p.id::text,
              coalesce(nullif(p.customer_label, ''), p.name) as name,
              p.description,
              q.id::text as quote_id, q.quote_number,
              q.grand_total_gross_amount::text as quote_total,
              q.currency_code
       from orva_tasking_projects p
       join sales_quotes q
         on q.id = p.quote_id and q.deleted_at is null
        and q.tenant_id = p.tenant_id
        and q.customer_entity_id = ?::uuid
       where p.id = ?::uuid and p.deleted_at is null
         and p.tenant_id = ?::uuid and p.organization_id = ?::uuid
         and p.customer_visible`,
      [scope.customerEntityId, projectId, scope.tenantId, scope.organizationId],
    )) as {
      id: string; name: string; description: string | null
      quote_id: string; quote_number: string; quote_total: string; currency_code: string | null
    }[]
    if (!project) return null

    const tasks = (await tem.execute(
      `select t.id::text, t.title, t.done, t.done_at::text,
              to_char(t.due_on, 'YYYY-MM-DD') as due_on,
              to_char(t.start_date, 'YYYY-MM-DD') as start_date,
              to_char(t.end_date, 'YYYY-MM-DD') as end_date,
              t.percent_done,
              (select coalesce(json_agg(json_build_object('title', l.title, 'hexColor', l.hex_color)
                        order by lower(l.title)), '[]'::json)
                 from orva_tasking_task_labels tl
                 join orva_tasking_labels l on l.id = tl.label_id and l.deleted_at is null
                where tl.task_id = t.id) as labels
       from orva_tasking_tasks t
       where t.project_id = ?::uuid and t.deleted_at is null and t.customer_visible
       order by t.done, t.due_on asc nulls last, t.position, t.created_at`,
      [project.id],
    )) as TaskRow[]

    // Only comments explicitly marked visible, plus everything the customer
    // wrote themselves. An internal note never leaves the building.
    const comments = (await tem.execute(
      `select c.id::text, c.body, c.created_at::text,
              (c.author_customer_user_id is not null) as from_customer,
              c.task_id::text
       from orva_tasking_task_comments c
       join orva_tasking_tasks t on t.id = c.task_id and t.deleted_at is null and t.customer_visible
       where t.project_id = ?::uuid and c.deleted_at is null
         and (c.is_customer_visible or c.author_customer_user_id is not null)
       order by c.created_at`,
      [project.id],
    )) as { id: string; body: string; created_at: string; from_customer: boolean; task_id: string }[]

    // Files are opt-in one at a time; absence of a flag row means not visible.
    const files = (await tem.execute(
      `select f.attachment_id::text as id, f.task_id::text
       from orva_tasking_task_attachment_flags f
       join orva_tasking_tasks t on t.id = f.task_id and t.deleted_at is null and t.customer_visible
       where t.project_id = ?::uuid and f.is_customer_visible
       order by f.created_at`,
      [project.id],
    )) as { id: string; task_id: string }[]

    // งวด against this quotation. The link is `metadata->>'quoteId'`, which is
    // how the rest of this app relates an invoice to the quote it bills.
    const installments = (await tem.execute(
      `select i.invoice_number, to_char(i.due_date, 'YYYY-MM-DD') as due_date,
              i.grand_total_gross_amount::text as total, i.status
       from sales_invoices i
       where i.deleted_at is null and i.tenant_id = ?::uuid
         and i.metadata->>'quoteId' = ?
       order by i.due_date nulls last, i.invoice_number`,
      [scope.tenantId, project.quote_id],
    )) as { invoice_number: string; due_date: string | null; total: string; status: string }[]

    return {
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
      },
      quote: {
        number: project.quote_number,
        total: Number(project.quote_total).toFixed(2),
        currency: project.currency_code ?? 'THB',
      },
      installments: installments.map((row) => ({
        number: row.invoice_number,
        dueDate: row.due_date,
        total: Number(row.total).toFixed(2),
        status: row.status,
      })),
      tasks: tasks.map((row) => ({
        id: row.id,
        title: row.title,
        done: row.done,
        doneAt: row.done_at,
        dueOn: row.due_on,
        startDate: row.start_date,
        endDate: row.end_date,
        percentDone: row.percent_done,
        daysOverdue: !row.done && row.due_on ? Math.max(0, daysBetween(row.due_on, today)) : 0,
        labels: row.labels ?? [],
      })),
      comments: comments.map((row) => ({
        id: row.id,
        taskId: row.task_id,
        body: row.body,
        fromCustomer: row.from_customer,
        createdAt: row.created_at,
      })),
      files,
    }
  })

  if (!payload) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(payload)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Tasking',
  summary: 'Portal: one project',
  methods: {
    GET: {
      summary: 'A published project with its visible tasks, comments, files, quotation and งวด',
      tags: ['Orva Tasking'],
      responses: [{
        status: 200,
        description: 'Project.',
        schema: z.object({
          project: z.object({ id: z.string(), name: z.string(), description: z.string().nullable() }),
          quote: z.object({ number: z.string(), total: z.string(), currency: z.string() }),
          installments: z.array(installmentSchema),
          tasks: z.array(taskSchema),
          comments: z.array(commentSchema),
          files: z.array(fileSchema),
        }),
      }],
      errors: [
        { status: 401, description: 'Not signed in to the portal', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'No such project for this customer — the same answer whether it exists or not', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
