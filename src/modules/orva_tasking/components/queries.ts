"use client"
import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import type { TaskProjectSummary } from './taskTypes'

/**
 * The tasking option sources more than one screen reads, each defined once.
 *
 * `orva_tasking.projects` is the key that first taught this app the lesson:
 * TasksPage cached the `{ items }` envelope, ProjectListPage cached the array,
 * and clicking from งาน to โปรเจกต์ died on `.filter is not a function`. A key
 * holds one shape; `src/lib/__tests__/queryKeyOwnership.test.ts` fails the
 * build when a first segment is defined in two files.
 */
export type Label = { id: string; title: string; hexColor: string; usageCount: number; updatedAt: string }
export type PortalProject = {
  id: string; name: string; total: number; done: number; percent: number
  overdue: number; dueSoon: number; nextDue: string | null; quoteNumber: string | null
}

const LABELS_KEY = ['orva_tasking.labels'] as const
const fetchLabels = async () => (await readApiResultOrThrow<{ items: Label[] }>('/api/orva_tasking/labels')).items

/** The same key and fetcher for TaskDrawer's `fetchQuery` after creating a label. */
export const labelsQuery = { queryKey: LABELS_KEY, queryFn: fetchLabels }

export function useLabels(enabled = true) {
  return useQuery({ queryKey: LABELS_KEY, queryFn: fetchLabels, enabled })
}

export function useTaskProjects() {
  const scopeVersion = useOrganizationScopeVersion()
  return useQuery({
    queryKey: ['orva_tasking.projects', scopeVersion],
    queryFn: async () =>
      (await readApiResultOrThrow<{ items: TaskProjectSummary[] }>('/api/orva_tasking/projects')).items,
  })
}

/** The customer's own projects, inside the portal session; the widget passes `retry: false`. */
export function usePortalProjects(options: { retry?: boolean } = {}) {
  return useQuery({
    queryKey: ['orva_tasking.portal.projects'],
    queryFn: async () =>
      (await readApiResultOrThrow<{ items: PortalProject[] }>('/api/orva_tasking/portal/projects')).items,
    ...options,
  })
}
