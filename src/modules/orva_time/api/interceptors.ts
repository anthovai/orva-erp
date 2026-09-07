import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { syncOrganization } from '../lib/apply'

/**
 * The โครงการ → งาน direction, and the lock on `code`.
 *
 * Why an interceptor and not a subscriber: `staff/events.ts` declares
 * `staff.timesheets.time_project.created/.updated/.deleted`, but nothing in
 * the staff module ever emits them — its time-projects route is a
 * `makeCrudRoute` with no `events:` config and no command backing, and no
 * route in that module configures one. `makeCrudRoute` does run
 * `runApiInterceptorsBefore` / `runApiInterceptorsAfter`, so this is the
 * designed seam that actually fires. No upstream route is replaced and no
 * upstream file is edited.
 */
const logger = createLogger('orva_time').child({ component: 'time-project-interceptors' })

const TARGET = 'staff/timesheets/time-projects'

/** `code` on a linked row belongs to orva_time (Q5). */
async function codeOwnedByLink(
  context: Parameters<NonNullable<ApiInterceptor['before']>>[1],
  timeProjectId: string,
): Promise<{ code: string; taskingName: string } | null> {
  const rows = (await context.em.execute(
    `select l.code, p.name as tasking_name
       from orva_time_project_links l
       join orva_tasking_projects p
              on p.id = l.tasking_project_id and p.tenant_id = l.tenant_id
      where l.time_project_id = ?::uuid and l.tenant_id = ?::uuid and l.deleted_at is null
      limit 1`,
    [timeProjectId, context.tenantId],
  )) as { code: string; tasking_name: string }[]
  const row = rows[0]
  return row ? { code: row.code, taskingName: row.tasking_name } : null
}

function idFromRequest(request: { url: string; body?: Record<string, unknown> }): string | null {
  const fromBody = request.body?.id
  if (typeof fromBody === 'string' && fromBody.length > 0) return fromBody
  // …/time-projects?id=<uuid> and …/time-projects/<uuid> both occur.
  try {
    const url = new URL(request.url, 'http://localhost')
    const query = url.searchParams.get('id')
    if (query) return query
    const last = url.pathname.split('/').filter(Boolean).pop()
    return last && /^[0-9a-f-]{36}$/i.test(last) ? last : null
  } catch {
    return null
  }
}

export const interceptors: ApiInterceptor[] = [
  {
    id: 'orva_time.time-project.lock-code',
    targetRoute: TARGET,
    methods: ['PUT', 'PATCH'],
    /**
     * Refuse a `code` change on a linked row, before the write.
     *
     * Enforced here and not only by hiding the field: a locked field that is
     * only hidden is not locked, and the link is matched on the code nowhere —
     * but the code is what the owner reads on the timesheet, and letting the
     * two screens disagree about a project's identifier is the confusion this
     * whole module exists to end.
     */
    async before(request, context) {
      const incoming = request.body?.code
      if (typeof incoming !== 'string') return { ok: true }

      const timeProjectId = idFromRequest(request)
      if (!timeProjectId) return { ok: true }

      const owned = await codeOwnedByLink(context, timeProjectId)
      if (!owned || owned.code === incoming) return { ok: true }

      return {
        ok: false,
        statusCode: 409,
        message: `รหัสโครงการนี้ผูกกับโปรเจกต์ "${owned.taskingName}" — แก้ชื่อโปรเจกต์ในหน้างานแทน (รหัส: ${owned.code})`,
      }
    },
  },
  {
    id: 'orva_time.time-project.propagate',
    targetRoute: TARGET,
    methods: ['PUT', 'PATCH', 'POST'],
    /**
     * A rename or a completion made on the โครงการ screen reaches the work
     * immediately, instead of waiting for the next reconcile.
     *
     * It re-plans the organization rather than acting on the request body: the
     * planner is the only thing that knows whether this is a `pull`, a no-op
     * because the value already matches, or drift that a human has to settle.
     * Duplicating that judgement here is how the two would fall out of step.
     */
    async after(_request, response, context) {
      // A failed write has nothing to propagate.
      if (response.statusCode >= 400) return {}
      try {
        const result = await syncOrganization(context.em, {
          tenantId: context.tenantId,
          organizationId: context.organizationId,
        })
        if (result.applied > 0 || result.reported.length > 0) {
          logger.info('propagated a โครงการ edit to the work', {
            applied: result.applied,
            reported: result.reported.length,
          })
        }
      } catch (error) {
        // Never fail the user's save because the mirror could not follow. The
        // reconcile command exists for exactly this gap.
        logger.error('could not propagate a โครงการ edit; sync will pick it up', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
      return {}
    },
  },
]

export default interceptors
