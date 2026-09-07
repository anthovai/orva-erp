import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { withTenantRls } from '@/lib/rls'
import { TimeProjectLink } from '../data/entities'
import { codeFor, planSync, statusFor, type Link, type SyncAction, type TaskingProject, type TimeProject } from './sync'

const logger = createLogger('orva_time').child({ component: 'apply' })

/**
 * Reading and writing the three sides, so `planSync` stays pure.
 *
 * The two project tables belong to other modules, so they are read with
 * tenant-filtered SQL and never through an ORM relation — `AGENTS.md` forbids
 * the relation, and the SQL keeps this module from owning either schema.
 *
 * `staff_time_projects` is *written* here rather than through the staff API
 * because a subscriber has no request to borrow a session from. The columns
 * written are the ones the sync owns (`name`, `code`, `status`); everything
 * the owner sets on the โครงการ screen — colour, cost centre, owner, type —
 * is never touched, so the two writers do not overlap.
 */

export type SyncScope = { tenantId: string; organizationId: string }

export async function readTaskingProjects(em: EntityManager, scope: SyncScope): Promise<TaskingProject[]> {
  const rows = (await em.execute(
    `select id, organization_id, name, is_archived
       from orva_tasking_projects
      where tenant_id = ?::uuid and organization_id = ?::uuid and deleted_at is null`,
    [scope.tenantId, scope.organizationId],
  )) as { id: string; organization_id: string; name: string; is_archived: boolean }[]
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    isArchived: row.is_archived,
  }))
}

export async function readTimeProjects(em: EntityManager, scope: SyncScope): Promise<TimeProject[]> {
  const rows = (await em.execute(
    `select id, organization_id, name, code, status
       from staff_time_projects
      where tenant_id = ?::uuid and organization_id = ?::uuid and deleted_at is null`,
    [scope.tenantId, scope.organizationId],
  )) as { id: string; organization_id: string; name: string; code: string; status: TimeProject['status'] }[]
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    code: row.code,
    status: row.status,
  }))
}

export async function readLinks(em: EntityManager, scope: SyncScope): Promise<Link[]> {
  const rows = await em.find(TimeProjectLink, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  return rows.map((row) => ({
    id: row.id,
    taskingProjectId: row.taskingProjectId,
    timeProjectId: row.timeProjectId,
    code: row.code,
    syncedName: row.syncedName,
    syncedStatus: row.syncedStatus,
  }))
}

/** Everything `planSync` needs, for one organization. */
export async function plan(em: EntityManager, scope: SyncScope): Promise<SyncAction[]> {
  const [tasking, time, links] = await Promise.all([
    readTaskingProjects(em, scope),
    readTimeProjects(em, scope),
    readLinks(em, scope),
  ])
  return planSync(tasking, time, links)
}

export type ApplyResult = { applied: number; reported: SyncAction[] }

/**
 * Carry out a plan.
 *
 * `drift`, `orphan` and `code-collision` are **reported, never applied**. They
 * are the cases where the sync cannot know the right answer, and a sync that
 * guesses is worse than one that says so — the whole point of the reconcile
 * command is that the owner can see what it will not decide for them.
 */
export async function applyPlan(
  em: EntityManager,
  scope: SyncScope,
  actions: SyncAction[],
): Promise<ApplyResult> {
  const reported: SyncAction[] = []
  let applied = 0

  await withTenantRls(em, scope.tenantId, async (tem) => {
    for (const action of actions) {
      switch (action.kind) {
        case 'create': {
          const inserted = (await tem.execute(
            `insert into staff_time_projects
               (tenant_id, organization_id, name, code, status, created_at, updated_at)
             values (?::uuid, ?::uuid, ?, ?, ?, now(), now())
             returning id`,
            [scope.tenantId, action.organizationId, action.name, action.code, action.status],
          )) as { id: string }[]
          const timeProjectId = inserted[0]?.id
          if (!timeProjectId) throw new Error('staff_time_projects insert returned no id')

          const link = tem.create(TimeProjectLink, {
            tenantId: scope.tenantId,
            organizationId: action.organizationId,
            taskingProjectId: action.taskingProjectId,
            timeProjectId,
            code: action.code,
            syncedName: action.name,
            syncedStatus: action.status,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          tem.persist(link)
          applied += 1
          break
        }

        case 'push': {
          await tem.execute(
            `update staff_time_projects set name = ?, status = ?, updated_at = now()
              where id = ?::uuid and tenant_id = ?::uuid`,
            [action.name, action.status, action.timeProjectId, scope.tenantId],
          )
          // Recording what was written is what stops the loop on the next hop.
          await tem.execute(
            `update orva_time_project_links
                set synced_name = ?, synced_status = ?, updated_at = now()
              where id = ?::uuid and tenant_id = ?::uuid`,
            [action.name, action.status, action.linkId, scope.tenantId],
          )
          applied += 1
          break
        }

        case 'pull': {
          await tem.execute(
            `update orva_tasking_projects set name = ?, is_archived = ?, updated_at = now()
              where id = ?::uuid and tenant_id = ?::uuid`,
            [action.name, action.isArchived, action.taskingProjectId, scope.tenantId],
          )
          await tem.execute(
            `update orva_time_project_links
                set synced_name = ?, synced_status = ?, updated_at = now()
              where id = ?::uuid and tenant_id = ?::uuid`,
            [action.name, statusFor({ isArchived: action.isArchived }), action.linkId, scope.tenantId],
          )
          applied += 1
          break
        }

        default:
          reported.push(action)
          break
      }
    }
    await tem.flush()
  })

  if (reported.length > 0) {
    logger.warn('sync left decisions to a human', { count: reported.length, kinds: reported.map((a) => a.kind) })
  }
  return { applied, reported }
}

/**
 * Reconcile one organization. Used by both the subscriber and the CLI.
 *
 * The subscriber does not try to apply "just the project that changed": the
 * plan is keyed by link id as well as project id, so filtering it down was
 * either wrong or a lie. Re-planning the whole organization is idempotent and,
 * at the scale this runs at, two selects — cheaper than being clever and
 * getting it wrong.
 */
export async function syncOrganization(em: EntityManager, scope: SyncScope): Promise<ApplyResult> {
  return applyPlan(em, scope, await plan(em, scope))
}

export { codeFor, planSync, statusFor }
