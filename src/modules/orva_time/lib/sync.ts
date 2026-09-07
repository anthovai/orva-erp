/**
 * What the sync would do, decided without touching a database.
 *
 * The planner is pure so the rules that matter — which project gets a time
 * project, what archiving means, when a rename propagates, and when two
 * independent edits are drift rather than a winner — are testable without a
 * tenant, a queue or a migration. `cli.ts` and the subscriber both read a plan
 * and apply it; neither decides anything.
 */

/** A tasking project, reduced to the fields the sync reads. */
export type TaskingProject = {
  id: string
  organizationId: string
  name: string
  isArchived: boolean
  /**
   * The customer on the quotation this project bills against, when it has
   * one. Resolved by the caller through `sales_quotes.customer_entity_id`,
   * because the quotation is the only place the work knows a customer from
   * (Phase 2 of the spec). Null for งานภายใน.
   */
  customerId?: string | null
}

/** A staff time project, reduced the same way. */
export type TimeProject = {
  id: string
  organizationId: string
  name: string
  code: string
  status: 'active' | 'on_hold' | 'completed'
  customerId?: string | null
}

export type Link = {
  id: string
  taskingProjectId: string
  timeProjectId: string
  code: string
  syncedName: string
  syncedStatus: string
}

/**
 * Q3: an archived tasking project's time project is `completed`. Never
 * deleted, because hours are logged against it and an hour already worked is
 * not undone by closing the project it was worked on.
 */
export function statusFor(project: Pick<TaskingProject, 'isArchived'>): TimeProject['status'] {
  return project.isArchived ? 'completed' : 'active'
}

/**
 * The code orva_time owns (Q5).
 *
 * Derived from the tasking project id, so it is stable across renames and
 * needs no counter, no sequence and no second round trip. Upstream's unique
 * index is on (organization, code); a uuid prefix collides at a rate nobody
 * will meet with eight projects, and `planSync` still reports a collision
 * rather than writing over one.
 */
export function codeFor(taskingProjectId: string): string {
  return `WORK-${taskingProjectId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
}

export type SyncAction =
  /** No time project exists for this tasking project — create one and link it. */
  | { kind: 'create'; taskingProjectId: string; organizationId: string; name: string; code: string; status: TimeProject['status']; customerId: string | null }
  /** The tasking side moved; write it to the time project and update the link. */
  | { kind: 'push'; linkId: string; timeProjectId: string; name: string; status: TimeProject['status'] }
  /**
   * The project's quotation named a customer the time project does not carry.
   * Its own action, because it is not a rename and must not be mistaken for
   * drift: the customer is derived, so the tasking side always wins and there
   * is nothing for a human to decide.
   */
  | { kind: 'set-customer'; linkId: string; timeProjectId: string; customerId: string | null }
  /** The time side moved; write it back to the tasking project. */
  | { kind: 'pull'; linkId: string; taskingProjectId: string; name: string; isArchived: boolean }
  /** Both sides moved independently. Reported, never resolved silently. */
  | { kind: 'drift'; linkId: string; taskingName: string; timeName: string; syncedName: string }
  /** The link points at a row that no longer exists. */
  | { kind: 'orphan'; linkId: string; missing: 'tasking' | 'time' }
  /** The generated code is taken by a time project that is not the linked one. */
  | { kind: 'code-collision'; taskingProjectId: string; code: string; heldBy: string }

/**
 * Reconcile three lists into the smallest set of actions that makes them agree.
 *
 * A standalone time project — one with no link — is left completely alone.
 * That is Q2: โครงการ may hold work that is not a tasking project at all,
 * such as internal admin or leave, and the sync has no business inventing a
 * project for it.
 */
export function planSync(
  taskingProjects: TaskingProject[],
  timeProjects: TimeProject[],
  links: Link[],
): SyncAction[] {
  const actions: SyncAction[] = []
  const byTasking = new Map(links.map((link) => [link.taskingProjectId, link]))
  const taskingById = new Map(taskingProjects.map((project) => [project.id, project]))
  const timeById = new Map(timeProjects.map((project) => [project.id, project]))
  const timeByCode = new Map(timeProjects.map((project) => [project.code, project]))

  for (const project of taskingProjects) {
    const link = byTasking.get(project.id)
    const wantStatus = statusFor(project)

    if (!link) {
      const code = codeFor(project.id)
      const holder = timeByCode.get(code)
      if (holder) {
        actions.push({ kind: 'code-collision', taskingProjectId: project.id, code, heldBy: holder.id })
        continue
      }
      actions.push({
        kind: 'create',
        taskingProjectId: project.id,
        organizationId: project.organizationId,
        name: project.name,
        code,
        status: wantStatus,
        customerId: project.customerId ?? null,
      })
      continue
    }

    const time = timeById.get(link.timeProjectId)
    if (!time) {
      actions.push({ kind: 'orphan', linkId: link.id, missing: 'time' })
      continue
    }

    // Derived from the quotation, so it is never drift — a difference here is
    // simply a value the time project has not been told yet.
    if ((project.customerId ?? null) !== (time.customerId ?? null)) {
      actions.push({
        kind: 'set-customer',
        linkId: link.id,
        timeProjectId: time.id,
        customerId: project.customerId ?? null,
      })
    }

    const taskingMoved = project.name !== link.syncedName
    const timeMoved = time.name !== link.syncedName || time.status !== link.syncedStatus
    const statusMoved = wantStatus !== link.syncedStatus

    // Both ends left the last synced value behind: two independent edits.
    if (taskingMoved && time.name !== link.syncedName && time.name !== project.name) {
      actions.push({
        kind: 'drift',
        linkId: link.id,
        taskingName: project.name,
        timeName: time.name,
        syncedName: link.syncedName,
      })
      continue
    }

    if (taskingMoved || statusMoved) {
      // The tasking side is the one that changed. Push it.
      if (time.name !== project.name || time.status !== wantStatus) {
        actions.push({ kind: 'push', linkId: link.id, timeProjectId: time.id, name: project.name, status: wantStatus })
      }
      continue
    }

    if (timeMoved) {
      // Only the time side changed. Pull it back (Q2: two-way).
      if (project.name !== time.name || project.isArchived !== (time.status === 'completed')) {
        actions.push({
          kind: 'pull',
          linkId: link.id,
          taskingProjectId: project.id,
          name: time.name,
          isArchived: time.status === 'completed',
        })
      }
    }
  }

  for (const link of links) {
    if (!taskingById.has(link.taskingProjectId)) {
      actions.push({ kind: 'orphan', linkId: link.id, missing: 'tasking' })
    }
  }

  return actions
}

/** A one-line-per-kind tally, for the CLI's summary and its dry run. */
export function summarize(actions: SyncAction[]): Record<SyncAction['kind'], number> {
  const tally = { create: 0, push: 0, pull: 0, 'set-customer': 0, drift: 0, orphan: 0, 'code-collision': 0 }
  for (const action of actions) tally[action.kind] += 1
  return tally
}
