"use client"
import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { BoardTask } from './taskTypes'

/** How far ahead to look. Vikunja offers a range; two weeks covers a sprint. */
const WINDOWS = [7, 14, 30] as const

/**
 * กำลังจะถึง — everything falling due soon, across every project.
 *
 * The one thing the tasks page cannot answer: it asks you to pick a project
 * first, so "what is due this week" meant opening eight projects in turn. This
 * groups by date instead of by project, because a deadline does not care which
 * project it belongs to.
 *
 * Overdue work is always included whatever window is chosen — the point of
 * asking what is due this week is to be shown what is already late.
 */
export default function UpcomingPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [days, setDays] = React.useState<(typeof WINDOWS)[number]>(14)

  const tasks = useQuery({
    queryKey: ['orva_tasking.upcoming', days, scopeVersion],
    queryFn: async () => (await readApiResultOrThrow<{ items: BoardTask[] }>(
      `/api/orva_tasking/tasks?bucket=open&dueWithinDays=${days}`,
    )).items,
  })

  const groups = React.useMemo(() => {
    const byDate = new Map<string, BoardTask[]>()
    for (const task of tasks.data ?? []) {
      if (!task.dueOn) continue
      const list = byDate.get(task.dueOn)
      if (list) list.push(task)
      else byDate.set(task.dueOn, [task])
    }
    return [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
  }, [tasks.data])

  const overdue = (tasks.data ?? []).filter((task) => task.daysOverdue > 0).length

  return (
    <Page>
      <PageHeader
        title={t('orva_tasking.upcoming.title', 'กำลังจะถึง')}
        description={t('orva_tasking.upcoming.description', 'งานที่ใกล้ครบกำหนดจากทุกโปรเจกต์ เรียงตามวัน — งานที่เลยกำหนดแล้วขึ้นก่อนเสมอ')}
      />
      <PageBody>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{t('orva_tasking.upcoming.window', 'ช่วงเวลา')}</span>
          <div className="inline-flex overflow-hidden rounded-md border" role="group">
            {WINDOWS.map((candidate) => (
              <button
                key={candidate}
                type="button"
                aria-pressed={days === candidate}
                onClick={() => setDays(candidate)}
                className={`border-r px-4 py-1.5 text-sm last:border-r-0 ${
                  days === candidate ? 'bg-primary font-medium text-primary-foreground' : 'hover:bg-muted'
                }`}
              >
                {t('orva_tasking.upcoming.days', '{n} วัน').replace('{n}', String(candidate))}
              </button>
            ))}
          </div>
          {overdue > 0 ? (
            <span className="rounded-full bg-status-error-bg px-2 py-0.5 text-xs text-status-error-text">
              {t('orva_tasking.upcoming.overdueCount', 'เลยกำหนดแล้ว {n}').replace('{n}', String(overdue))}
            </span>
          ) : null}
        </div>

        {tasks.isLoading ? <p className="text-sm text-muted-foreground">…</p> : null}
        {tasks.error ? (
          <div className="rounded-md border p-4">
            <p className="text-sm text-status-error-text">{t('orva_tasking.loadFailed', 'โหลดงานไม่สำเร็จ')}</p>
            <Button className="mt-2" variant="outline" onClick={() => tasks.refetch()}>
              {t('orva_tasking.retry', 'ลองอีกครั้ง')}
            </Button>
          </div>
        ) : null}

        {tasks.data && groups.length === 0 ? (
          <div className="rounded-md border p-6 text-center">
            <p className="text-sm text-muted-foreground">
              {t('orva_tasking.upcoming.empty', 'ไม่มีงานครบกำหนดในช่วงนี้')}
            </p>
            <Button asChild className="mt-3" variant="outline">
              <Link href="/backend/tasking">{t('orva_tasking.upcoming.toTasks', 'ไปที่งาน')}</Link>
            </Button>
          </div>
        ) : null}

        <div className="space-y-4">
          {groups.map(([date, list]) => {
            const late = list.some((task) => task.daysOverdue > 0)
            return (
              <section key={date}>
                <h2 className={`mb-2 text-sm font-medium tabular-nums ${late ? 'text-status-error-text' : ''}`}>
                  {date}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {t('orva_tasking.upcoming.taskCount', '{n} งาน').replace('{n}', String(list.length))}
                  </span>
                </h2>
                <ul className="overflow-hidden rounded-md border">
                  {list.map((task) => (
                    <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 text-sm last:border-b-0">
                      <Link
                        href={`/backend/tasking?project=${task.projectId}`}
                        className="font-medium hover:underline"
                      >
                        {task.title}
                      </Link>
                      {/* The project is the point of a cross-project list. */}
                      <span className="text-xs text-muted-foreground">{task.projectName}</span>
                      {task.daysOverdue > 0 ? (
                        <span className="rounded-full bg-status-error-bg px-2 py-0.5 text-xs text-status-error-text">
                          {t('orva_tasking.overdue', 'เลย {days} วัน').replace('{days}', String(task.daysOverdue))}
                        </span>
                      ) : null}
                      {task.labels.map((label) => (
                        <span key={label.id} className="rounded-full border px-2 py-0.5 text-xs">
                          <span
                            aria-hidden="true"
                            className="mr-1 inline-block size-2 rounded-full align-middle"
                            style={{ backgroundColor: label.hexColor }}
                          />
                          {label.title}
                        </span>
                      ))}
                      {task.percentDone > 0 ? (
                        <span className="ml-auto tabular-nums text-xs text-muted-foreground">{task.percentDone}%</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </PageBody>
    </Page>
  )
}
