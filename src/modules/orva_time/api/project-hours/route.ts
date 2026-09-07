import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import type { ProjectHours } from '../../lib/hours'

/**
 * Hours logged, per tasking project.
 *
 * This lives in `orva_time` and not in `orva_tasking` on purpose. The query
 * spans two modules' tables, and `orva_time` is the module that owns that
 * seam — putting it in `orva_tasking` would make the work module read staff
 * data, which is the coupling this whole design exists to avoid. The screens
 * fetch it alongside their own data and join on `taskingProjectId`, the same
 * way โปรเจกต์ already fetches billing from `orva_documents`.
 *
 * Read-only. Phase 3 adds no writes anywhere.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_tasking.view'] },
}

const rowSchema = z.object({
  taskingProjectId: z.string(),
  minutes: z.number(),
  entries: z.number(),
  running: z.number(),
  lastEntryOn: z.string().nullable(),
})

type Row = {
  tasking_project_id: string
  minutes: string | number | null
  entries: string | number | null
  running: string | number | null
  /** Already `YYYY-MM-DD`: the SQL casts it, see `::text` below. */
  last_entry_on: string | null
}

const int = (value: string | number | null): number => {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const day = (value: string | null): string | null => (value ? value.slice(0, 10) : null)

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const items = await withTenantRls(em, auth.tenantId, async (tem) => {
    /*
      A left join from the link, so a project with a time project and no
      entries comes back as a zero rather than as a missing key — the screens
      need to tell "nothing logged" apart from "no timesheet at all".

      A running timer carries duration_minutes = 0 until it is stopped, so it
      is counted, never summed. Folding it in would report work in progress as
      no work.
    */
    const rows = (await tem.execute(
      `select l.tasking_project_id,
              coalesce(sum(e.duration_minutes), 0) as minutes,
              count(e.id) as entries,
              count(e.id) filter (where e.started_at is not null and e.ended_at is null) as running,
              -- Cast to text, not a Date. The driver parses a bare DATE as
              -- local midnight, so in Bangkok max(date) = 2026-09-07 came back
              -- as 2026-09-06T17:00:00Z and slicing an ISO string read a day
              -- early. Letting Postgres format it makes that impossible rather
              -- than merely tested for.
              max(e.date)::text as last_entry_on
         from orva_time_project_links l
         left join staff_time_entries e
                on e.time_project_id = l.time_project_id
               and e.tenant_id = l.tenant_id
               and e.deleted_at is null
        where l.tenant_id = ?::uuid and l.organization_id = ?::uuid and l.deleted_at is null
        group by l.tasking_project_id`,
      [auth.tenantId, organizationId],
    )) as Row[]

    return rows.map((row): ProjectHours => ({
      taskingProjectId: row.tasking_project_id,
      minutes: int(row.minutes),
      entries: int(row.entries),
      running: int(row.running),
      lastEntryOn: day(row.last_entry_on),
    }))
  })

  return Response.json({ items })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Time',
  summary: 'Hours per work project',
  methods: {
    GET: {
      summary: 'Minutes logged against each tasking project, through its linked timesheet project',
      tags: ['Orva Time'],
      responses: [{ status: 200, description: 'One row per linked project.', schema: z.object({ items: z.array(rowSchema) }) }],
    },
  },
}
