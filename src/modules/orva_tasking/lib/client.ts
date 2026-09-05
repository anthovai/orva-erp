/**
 * Server-side client for KKG-Tasking (the company's Vikunja fork), which runs
 * as the `tasking` service in this stack and stores the task data.
 *
 * Tasks are a real Orva module — Orva renders the screens and owns the
 * navigation — but the storage and the task rules live in Tasking rather than
 * being reimplemented here. That fork is 233,000 lines with Kanban, Gantt,
 * reminders and its own AI chat; duplicating its data model would mean two
 * places to change a task and no way to take upstream Vikunja releases.
 *
 * Auth is one API token for the whole install, so every Orva user acts as the
 * same Tasking user. That is honest for a business run by one person; it is
 * the thing to revisit first when a second person needs their own history.
 * The token never reaches the browser — only this module's API routes call it.
 */

export type TaskingConfig = { baseUrl: string; token: string }

export class TaskingNotConfiguredError extends Error {
  constructor() {
    super('KKG-Tasking is not configured: set TASKING_TOKEN (and TASKING_URL) in the environment.')
    this.name = 'TaskingNotConfiguredError'
  }
}

/**
 * Reads the connection from the environment. Absent config is a normal state —
 * the module ships before the token exists — so callers surface it as guidance
 * rather than as a crash.
 */
export function readTaskingConfig(): TaskingConfig | null {
  const token = process.env.TASKING_TOKEN?.trim()
  if (!token) return null
  const baseUrl = (process.env.TASKING_URL?.trim() || 'http://localhost:3456').replace(/\/+$/, '')
  return { baseUrl, token }
}

async function call<T>(config: TaskingConfig, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${config.baseUrl}/api/v2${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
    // Task lists change constantly; a cached answer would show stale work.
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Tasking ${init?.method ?? 'GET'} ${path} failed (${res.status}): ${body.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

/** A Vikunja project — one per piece of client work, in this business. */
export type TaskingProject = {
  id: number
  title: string
  description?: string | null
  is_archived?: boolean
}

export type TaskingTask = {
  id: number
  identifier?: string
  title: string
  description?: string | null
  done: boolean
  done_at?: string | null
  due_date?: string | null
  priority?: number
  percent_done?: number
  project_id?: number
}

/** Vikunja sends a zero time as year 1; treat that as "no date". */
export function cleanDate(value: string | null | undefined): string | null {
  if (!value) return null
  return value.startsWith('0001-01-01') ? null : value
}

export async function listProjects(config: TaskingConfig): Promise<TaskingProject[]> {
  const projects = await call<TaskingProject[] | null>(config, '/projects')
  return (projects ?? []).filter((project) => !project.is_archived)
}

export async function listTasks(config: TaskingConfig, projectId: number): Promise<TaskingTask[]> {
  const tasks = await call<TaskingTask[] | null>(config, `/projects/${projectId}/tasks`)
  return tasks ?? []
}

export async function createTask(
  config: TaskingConfig,
  projectId: number,
  input: { title: string; description?: string | null; due_date?: string | null; priority?: number },
): Promise<TaskingTask> {
  return call<TaskingTask>(config, `/projects/${projectId}/tasks`, {
    method: 'POST',
    body: JSON.stringify({
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      ...(input.due_date ? { due_date: new Date(input.due_date).toISOString() } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
    }),
  })
}

/** Toggling done is the one edit worth doing without leaving the list. */
export async function setTaskDone(config: TaskingConfig, taskId: number, done: boolean): Promise<TaskingTask> {
  return call<TaskingTask>(config, `/tasks/${taskId}`, {
    method: 'POST',
    body: JSON.stringify({ done }),
  })
}

/**
 * How far along a project's work is — the number that belongs beside billing
 * progress on the Projects screen, so "80% done, 30% billed" becomes visible.
 */
export function taskProgress(tasks: readonly TaskingTask[]): { total: number; done: number; donePct: number } {
  const total = tasks.length
  const done = tasks.filter((task) => task.done).length
  return { total, done, donePct: total > 0 ? Math.round((done / total) * 1000) / 10 : 0 }
}
