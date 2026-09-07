"use client"
import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { BoardTask } from './taskTypes'
import { addDays, dayIndex, timelineSpan } from '../lib/timeline'

/**
 * The timeline.
 *
 * Only tasks with both a start and an end appear: one date is a deadline, not
 * a duration, and drawing it as a bar would invent information. Tasks with a
 * single date are counted in a line under the chart so nobody wonders where
 * their work went.
 *
 * A custom surface, like the board — no installed primitive draws a Gantt.
 * Everything around it is platform-native.
 */
export function TimelineView({
  tasks,
  onOpenTask,
  onChanged,
}: {
  tasks: BoardTask[]
  onOpenTask: (id: string) => void
  onChanged: () => Promise<void> | void
}) {
  const t = useT()
  const [busy, setBusy] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState('')

  /**
   * A task earns a place on the timeline if it carries any date at all.
   *
   * Spans are drawn from start→end where both exist. A task with only a due
   * date becomes a one-day marker on that date rather than being dropped:
   * most of the imported work has a deadline and no span, and a timeline that
   * shows a third of the dated tasks is worse than one that shows a marker.
   */
  const dated = React.useMemo(() => tasks
    .map((task) => {
      const from = task.startDate ?? task.dueOn ?? task.endDate
      const to = task.endDate ?? task.dueOn ?? task.startDate
      if (!from || !to) return null
      // Guard against a reversed pair rather than drawing a negative bar.
      const [start, end] = from <= to ? [from, to] : [to, from]
      return { task, start, end, isMarker: !task.startDate || !task.endDate }
    })
    .filter((row): row is { task: BoardTask; start: string; end: string; isMarker: boolean } => row !== null),
  [tasks])

  const undated = tasks.length - dated.length
  const span = timelineSpan(dated.map((row) => ({ startDate: row.start, endDate: row.end })))

  const shift = async (task: BoardTask, days: number) => {
    if (!task.startDate || !task.endDate || days === 0) return
    setBusy(true)
    try {
      const res = await apiCall<{ ok: true }>('/api/orva_tasking/tasks', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: task.id,
          startDate: addDays(task.startDate, days),
          endDate: addDays(task.endDate, days),
          updatedAt: task.updatedAt,
        }),
      })
      if (!res.ok || !res.result) {
        throw new Error((res.result as { error?: string } | undefined)?.error ?? t('orva_tasking.saveFailed', 'บันทึกไม่สำเร็จ'))
      }
      setAnnouncement(
        t('orva_tasking.a11y.moved', 'เลื่อน "{title}" ไป {days} วัน')
          .replace('{title}', task.title)
          .replace('{days}', String(days)),
      )
      await onChanged()
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err), 'error')
    } finally { setBusy(false) }
  }

  /**
   * Drag a bar sideways to reschedule.
   *
   * The pixel delta is converted to whole days against the track's own width,
   * so the bar cannot land between two days.
   */
  const onBarPointerDown = (task: BoardTask) => (event: React.PointerEvent<HTMLButtonElement>) => {
    if (busy) return
    const track = event.currentTarget.parentElement
    if (!track) return
    const trackWidth = track.getBoundingClientRect().width
    const startX = event.clientX
    const dayWidth = trackWidth / span.days
    let days = 0

    const onMove = (moveEvent: PointerEvent) => {
      days = Math.round((moveEvent.clientX - startX) / dayWidth)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (days !== 0) void shift(task, days)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  if (dated.length === 0) {
    return (
      <div className="rounded-md border p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {t('orva_tasking.noDatedTasks', 'ยังไม่มีงานที่ใส่วันไว้')}
        </p>
        {undated > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t('orva_tasking.undatedCount', 'มีงาน {count} ใบที่ยังไม่ได้ใส่วัน — เปิดงานแล้วใส่วันเริ่มกับวันจบ')
              .replace('{count}', String(undated))}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p aria-live="polite" className="sr-only">{announcement}</p>

      {/* Wide content scrolls inside its own container, never the page. */}
      <div className="overflow-x-auto rounded-md border">
        <div className="min-w-3xl">
          <div className="flex border-b bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <span className="w-56 shrink-0">{t('orva_tasking.col.task', 'งาน')}</span>
            <span className="flex-1 tabular-nums">{span.from} → {span.to}</span>
          </div>

          <ul>
            {dated.map(({ task, start, end, isMarker }) => {
              const from = dayIndex(span.from, start)
              const length = dayIndex(start, end) + 1
              const left = (from / span.days) * 100
              // A one-day marker would be a hairline at month scale, so give it
              // a floor wide enough to see and to grab.
              const width = Math.max((length / span.days) * 100, 1.5)
              return (
                <li key={task.id} className="flex items-center border-b px-3 py-2 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => onOpenTask(task.id)}
                    className="w-56 shrink-0 truncate pr-2 text-left text-sm hover:underline"
                  >
                    <span className={task.done ? 'text-muted-foreground line-through' : ''}>{task.title}</span>
                  </button>
                  <div className="relative h-7 flex-1 rounded bg-muted">
                    <button
                      type="button"
                      disabled={busy}
                      onPointerDown={onBarPointerDown(task)}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowLeft') { event.preventDefault(); void shift(task, -1) }
                        if (event.key === 'ArrowRight') { event.preventDefault(); void shift(task, 1) }
                        if (event.key === 'Enter') { event.preventDefault(); onOpenTask(task.id) }
                      }}
                      aria-label={t('orva_tasking.a11y.bar', '{title} · {from} ถึง {to} · ลูกศรซ้ายขวาเลื่อนวัน')
                        .replace('{title}', task.title)
                        .replace('{from}', start)
                        .replace('{to}', end)}
                      className={`absolute top-1 h-5 cursor-ew-resize rounded text-left text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isMarker ? 'px-0' : 'px-2'} ${
                        task.done ? 'bg-muted-foreground/40' : task.daysOverdue > 0 ? 'bg-status-error-bg' : 'bg-primary'
                      }`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    >
                      {/* A marker has no duration to state, so it says nothing
                          rather than claiming "1 วัน" about a deadline. */}
                      {isMarker ? null : (
                        <span className={`truncate ${task.done || task.daysOverdue > 0 ? '' : 'text-primary-foreground'}`}>
                          {length} {t('orva_tasking.days', 'วัน')}
                        </span>
                      )}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {undated > 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('orva_tasking.undatedExcluded', 'ไม่แสดงงาน {count} ใบที่ยังไม่มีวันเริ่มหรือวันจบ')
              .replace('{count}', String(undated))}
          </p>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={() => onChanged()} disabled={busy}>
          {t('orva_tasking.reload', 'โหลดใหม่')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('orva_tasking.timelineHint', 'ลากแถบเพื่อเลื่อนวัน หรือกด Tab ไปที่แถบแล้วใช้ลูกศรซ้ายขวา')}
      </p>
    </div>
  )
}

export default TimelineView
