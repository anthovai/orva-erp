"use client"
import * as React from 'react'
import Link from 'next/link'
import { CircleCheck, CircleDot, TriangleAlert } from 'lucide-react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

/**
 * The blocks the reference design puts around the dashboard — project
 * progress, the personal work queue, and system status — built from what this
 * business actually has rather than from the mockup's furniture.
 *
 * The reference also carries a revenue line chart, a department donut and a
 * knowledge graph. Those are not here, and their absence is a decision: this
 * company has eight projects and a handful of invoices, so a twelve-month
 * revenue curve drawn from it would be a picture of noise, and a donut of one
 * department is a circle. A chart earns its place when there is a shape to
 * see; until then these three panels say more per pixel.
 */

const panel = 'rounded-xl border bg-card'
const panelHead = 'flex items-center justify-between gap-2 border-b px-4 py-3'

function PanelTitle({ children, href, action }: { children: React.ReactNode; href?: string; action?: React.ReactNode }) {
  return (
    <div className={panelHead}>
      {href ? (
        <Link href={href} className="text-sm font-semibold hover:underline">{children}</Link>
      ) : (
        <h2 className="text-sm font-semibold">{children}</h2>
      )}
      {action}
    </div>
  )
}

function useJson<T>(url: string) {
  const [data, setData] = React.useState<T | null>(null)
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => {
    let cancelled = false
    apiCall<T>(url)
      .then((res) => {
        if (cancelled) return
        if (!res.ok || !res.result) throw new Error(url)
        setData(res.result)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [url])
  return { data, failed }
}

/* ------------------------------------------------------------------ */

type ProjectRow = {
  id: string; name: string; quoteNumber: string | null
  total: number; done: number; donePct: number; overdue: number
  isArchived: boolean
}

/**
 * Work in flight, with the bar the reference draws — except the percentage is
 * counted from tasks ticked off, which is the same number the billing screens
 * compare against money invoiced. A progress bar that came from anywhere else
 * would be a second opinion about the same project.
 */
export function ProjectProgressPanel() {
  const t = useT()
  const { data, failed } = useJson<{ items: ProjectRow[] }>('/api/orva_tasking/projects?pageSize=50')
  if (failed) return null

  const live = (data?.items ?? [])
    .filter((p) => !p.isArchived && p.total > 0 && p.done < p.total)
    .sort((a, b) => b.donePct - a.donePct)
    .slice(0, 5)
  if (data && live.length === 0) return null

  return (
    <section className={panel} aria-label={t('orva.home.projects.title', 'งานที่กำลังเดิน')}>
      <PanelTitle href="/backend/work-projects">{t('orva.home.projects.title', 'งานที่กำลังเดิน')}</PanelTitle>
      <div className="flex flex-col divide-y">
        {live.map((p) => (
          <Link key={p.id} href={`/backend/tasking?projectId=${p.id}`} className="px-4 py-3 transition-colors hover:bg-muted/40">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm font-medium">{p.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {p.done}/{p.total}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, p.donePct)}%` }} />
              </div>
              <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{p.donePct}%</span>
            </div>
            {p.overdue > 0 ? (
              <div className="mt-1 text-xs text-status-error-text">
                {t('orva.home.projects.overdue', 'เลยกำหนด {count} งาน', { count: p.overdue })}
              </div>
            ) : null}
          </Link>
        ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */

type TaskRow = {
  id: string; title: string; projectName: string | null
  dueOn: string | null; daysOverdue: number
}

/** The personal queue, soonest first — overdue said as overdue. */
export function MyTasksPanel() {
  const t = useT()
  const { data, failed } = useJson<{ items: TaskRow[] }>('/api/orva_tasking/tasks?bucket=open&pageSize=6&dueWithinDays=14')
  if (failed) return null
  const tasks = data?.items ?? []
  if (data && tasks.length === 0) return null

  return (
    <section className={panel} aria-label={t('orva.home.tasks.title', 'งานของฉัน')}>
      <PanelTitle href="/backend/work-upcoming">{t('orva.home.tasks.title', 'งานของฉัน')}</PanelTitle>
      <div className="flex flex-col divide-y">
        {tasks.slice(0, 6).map((task) => (
          <Link key={task.id} href="/backend/tasking" className="flex items-start gap-2 px-4 py-2.5 transition-colors hover:bg-muted/40">
            <CircleDot className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{task.title}</span>
              {task.projectName ? (
                <span className="block truncate text-xs text-muted-foreground">{task.projectName}</span>
              ) : null}
            </span>
            {task.daysOverdue > 0 ? (
              <span className="shrink-0 text-xs tabular-nums text-status-error-text">
                {t('orva.home.tasks.late', 'เลย {days} วัน', { days: task.daysOverdue })}
              </span>
            ) : task.dueOn ? (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{task.dueOn.slice(5)}</span>
            ) : null}
          </Link>
        ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */

type Check = { id: string; labelKey: string; severity: 'blocker' | 'warning' | 'ok'; detail: string; href: string | null }

/**
 * System status, from the readiness endpoint rather than a green dot that
 * always says "All Systems Operational".
 *
 * The reference shows that phrase permanently lit, which is the one thing a
 * status panel must not do. This reads the same eleven checks the readiness
 * screen does, so when it says everything is fine, something asked.
 */
export function SystemStatusPanel() {
  const t = useT()
  const { data, failed } = useJson<{ checks: Check[]; summary: { blockers: number; warnings: number; ready: boolean }; unread?: string[] }>('/api/orva/readiness')
  if (failed || !data) return null

  const { summary } = data
  const problems = data.checks.filter((c) => c.severity !== 'ok').slice(0, 4)
  const tone = summary.blockers > 0 ? 'bad' : summary.warnings > 0 ? 'warn' : 'good'

  return (
    <section className={panel} aria-label={t('orva.home.status.title', 'สถานะระบบ')}>
      <PanelTitle href="/backend/readiness">{t('orva.home.status.title', 'สถานะระบบ')}</PanelTitle>
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          {tone === 'good' ? (
            <CircleCheck className="size-4 shrink-0 text-status-success-text" aria-hidden />
          ) : (
            <TriangleAlert className={cn('size-4 shrink-0', tone === 'bad' ? 'text-status-error-text' : 'text-status-warning-text')} aria-hidden />
          )}
          <span className="text-sm font-medium">
            {tone === 'good'
              ? t('orva.home.status.ready', 'พร้อมใช้งาน')
              : summary.blockers > 0
                ? t('orva.home.status.blocked', 'ติด {count} เรื่อง', { count: summary.blockers })
                : t('orva.home.status.warned', 'ควรดู {count} เรื่อง', { count: summary.warnings })}
          </span>
        </div>
        {problems.length ? (
          <ul className="mt-2 flex flex-col gap-1.5">
            {problems.map((c) => (
              <li key={c.id} className="text-xs leading-5 text-muted-foreground">
                <span className={cn('mr-1.5 inline-block size-1.5 rounded-full align-middle',
                  c.severity === 'blocker' ? 'bg-status-error-text' : 'bg-status-warning-text')} />
                {c.href ? <Link href={c.href} className="hover:underline">{c.detail}</Link> : c.detail}
              </li>
            ))}
          </ul>
        ) : null}
        {data.unread?.length ? (
          <p className="mt-2 text-xs text-status-warning-text">
            {t('orva.home.status.unread', 'ตรวจไม่ได้ {count} ข้อ', { count: data.unread.length })}
          </p>
        ) : null}
      </div>
    </section>
  )
}
