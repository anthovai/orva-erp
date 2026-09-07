"use client"
import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type PortalProject = {
  id: string; name: string; total: number; done: number; percent: number
  overdue: number; nextDue: string | null
}

/**
 * Work progress on the customer's own front page.
 *
 * Renders nothing at all when there is nothing shared, and nothing when the
 * call fails: a widget injected into someone else's page has no business
 * putting an error box on it. The full list carries the real empty and error
 * states.
 */
export default function PortalWorkWidget() {
  const t = useT()
  const { orgSlug } = usePortalContext()

  const projects = useQuery({
    queryKey: ['orva_tasking.portal.projects'],
    queryFn: async () =>
      (await readApiResultOrThrow<{ items: PortalProject[] }>('/api/orva_tasking/portal/projects')).items,
    retry: false,
  })

  if (projects.isLoading) {
    return <p className="text-sm text-muted-foreground">{t('orva_tasking.portal.loading', 'กำลังโหลด…')}</p>
  }
  if (projects.error || !projects.data?.length) return null

  return (
    <div className="space-y-3">
      {projects.data.slice(0, 4).map((project) => (
        <Link
          key={project.id}
          href={`/${orgSlug}/portal/work/${project.id}`}
          className="block rounded-lg border p-3 hover:bg-muted"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium">{project.name}</span>
            <span className="tabular-nums text-sm text-muted-foreground">
              {project.done}/{project.total} · {project.percent}%
            </span>
          </div>
          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={project.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('orva_tasking.portal.progressLabel', 'ความคืบหน้า {name}').replace('{name}', project.name)}
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${project.percent}%` }} />
          </div>
          {project.overdue > 0 ? (
            <p className="mt-1 text-xs text-status-error-text">
              {t('orva_tasking.portal.overdue', 'เลยกำหนด {n}').replace('{n}', String(project.overdue))}
            </p>
          ) : project.nextDue ? (
            <p className="mt-1 tabular-nums text-xs text-muted-foreground">
              {t('orva_tasking.portal.nextDue', 'ถัดไป {date}').replace('{date}', project.nextDue)}
            </p>
          ) : null}
        </Link>
      ))}

      {projects.data.length > 4 ? (
        <Link href={`/${orgSlug}/portal/work`} className="text-sm underline">
          {t('orva_tasking.portal.seeAll', 'ดูทั้งหมด {n} โปรเจกต์').replace('{n}', String(projects.data.length))}
        </Link>
      ) : null}
    </div>
  )
}
