import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * The events a tasking project raises.
 *
 * This module emitted nothing before. These are additive — no consumer
 * existed to break, and `events.ts` may gain definitions without touching the
 * `EventDefinition` shape the backward-compatibility contract freezes.
 *
 * `orva_time` listens to them to keep the staff timesheet project (โครงการ)
 * in step. They are deliberately about the project and not the task: hours are
 * logged against a project, and a task-level stream would be 87 events where
 * one is wanted. Task events can be added when something asks for them.
 *
 * `strict` is on. A typo in an event id should fail the write that tried to
 * emit it, not log an error and carry on emitting something nobody listens
 * for — a sync that silently stops syncing is the failure this whole module
 * exists to avoid.
 */
const events = [
  { id: 'orva_tasking.project.created', label: 'Work Project Created', entity: 'project', category: 'crud' },
  { id: 'orva_tasking.project.updated', label: 'Work Project Updated', entity: 'project', category: 'crud' },
  { id: 'orva_tasking.project.archived', label: 'Work Project Archived', entity: 'project', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'orva_tasking',
  events,
  strict: true,
})

/** The typed emitter. Only the three ids above compile. */
export const emitTaskingEvent = eventsConfig.emit

export type TaskingEventId = (typeof events)[number]['id']

/**
 * What every project event carries.
 *
 * Scalar values only, and the whole of what a consumer needs to act without
 * reading the tasking tables back — a subscriber that has to re-query is a
 * subscriber that races the next write.
 */
export type TaskingProjectEvent = {
  id: string
  tenantId: string
  organizationId: string
  name: string
  isArchived: boolean
  quoteId: string | null
  updatedAt: string
}

export default eventsConfig
