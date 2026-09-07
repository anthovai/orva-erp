"use client"
import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useLocale } from '@open-mercato/shared/lib/i18n/context'
import type { BoardTask } from './taskTypes'
import {
  addDays,
  dayIndex,
  dayList,
  defaultGanttRange,
  ganttWindow,
  monthGroups,
} from '../lib/timeline'

/**
 * The timeline, as a Gantt chart.
 *
 * The earlier version was a table of bars with one header cell reading
 * "2026-08-30 → 2026-09-22" and each bar labelled with its own length. That
 * answers "how long is this task" and nothing else: you could not tell which
 * week a bar sat in, where today was, or whether two tasks overlapped, which
 * is the whole reason to draw a Gantt.
 *
 * So it now has what Vikunja's has, and for the same reasons:
 *
 * - a two-row calendar header — months above, numbered days with weekday
 *   letters below — so a bar has a date to be read against;
 * - today marked in the header and as a line down the chart;
 * - one column per day with visible gridlines and shaded weekends;
 * - the task title written inside its bar, not its duration. The length is
 *   already the width of the bar; the title is the thing you cannot see;
 * - a date range you choose (defaulting to Vikunja's today−15 → today+55)
 *   rather than a window derived from whatever tasks happen to have dates;
 * - undated work shown on request as dashed bars, so it can be dragged onto
 *   the calendar instead of being reported as a footnote.
 *
 * Days are laid out in pixels, not percentages: at 30px a day the chart is
 * wider than the screen and scrolls, which is what keeps a two-month window
 * readable. A percentage layout has to shrink every day to fit, and that is
 * how the old one ended up unreadable.
 *
 * A custom surface, like the board — no installed primitive draws a Gantt.
 * Everything around it is platform-native.
 */

/**
 * A day column, in pixels. Vikunja's floor is 30; this is 32 so the columns
 * can be laid out with the design-system `w-8` class instead of an arbitrary
 * width, which keeps the exceptions to token-free geometry down to three.
 *
 * KEEP IN SYNC: the day cells below are `w-8`. This constant is what the
 * pointer drag divides by to turn pixels into days, so if one changes and the
 * other does not, dragging a bar lands it on the wrong day.
 */
const DAY_WIDTH = 32
/** How long a bar dragged off the undated list becomes, in days. */
const UNDATED_SPAN = 3
/** How long a task created from the chart runs, in days. Drag to change it. */
const NEW_TASK_SPAN = 3

type Bar = {
  task: BoardTask
  start: string
  end: string
  /** No dates at all — only present when the reader asked to see these. */
  isUndated: boolean
}

export function TimelineView({
  tasks,
  onOpenTask,
  onChanged,
  onCreate,
}: {
  tasks: BoardTask[]
  onOpenTask: (id: string) => void
  onChanged: () => Promise<void> | void
  /** Omit to hide the create form, for a reader who may not add work. */
  onCreate?: (title: string, startDate: string, endDate: string) => Promise<void>
}) {
  const t = useT()
  const locale = useLocale()
  const [busy, setBusy] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState('')
  const [showUndated, setShowUndated] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const draftRef = React.useRef<HTMLInputElement>(null)

  /**
   * Today, and the range, resolved after mount.
   *
   * The default range is relative to today, and today on the server is not
   * today for the reader. Rendering it during SSR produces a chart that
   * changes on hydration; deferring it costs one frame and is always right.
   */
  const [today, setToday] = React.useState<string | null>(null)
  const [range, setRange] = React.useState<{ from: string; to: string } | null>(null)
  React.useEffect(() => {
    const now = new Date()
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    const iso = local.toISOString().slice(0, 10)
    setToday(iso)
    setRange((current) => current ?? { from: defaultGanttRange(iso).from, to: defaultGanttRange(iso).to })
  }, [])

  const bars = React.useMemo<Bar[]>(() => tasks.flatMap((task): Bar[] => {
    const from = task.startDate ?? task.dueOn ?? task.endDate
    const to = task.endDate ?? task.dueOn ?? task.startDate
    if (!from || !to) {
      if (!showUndated || !today) return []
      // Parked on today so it can be dragged where it belongs. Vikunja does
      // the same, and the dashed edge says the dates are not real yet.
      return [{ task, start: today, end: addDays(today, UNDATED_SPAN - 1), isUndated: true }]
    }
    // Guard against a reversed pair rather than drawing a negative bar.
    const [start, end] = from <= to ? [from, to] : [to, from]
    return [{ task, start, end, isUndated: false }]
  }), [tasks, showUndated, today])

  const undatedCount = React.useMemo(
    () => tasks.filter((task) => !task.startDate && !task.endDate && !task.dueOn).length,
    [tasks],
  )

  const span = React.useMemo(
    () => (range ? ganttWindow(range, bars) : null),
    [range, bars],
  )

  /**
   * Gregorian years, even in Thai.
   *
   * `Intl` gives `th` the Buddhist calendar, so a plain format writes
   * "กันยายน 2569" over a chart whose tasks are all dated 2026 in every
   * other screen in Orva. `-u-ca-gregory` keeps the Thai month name and the
   * year the rest of the app uses.
   */
  const calendarLocale = React.useMemo(
    () => (locale.startsWith('th') ? 'th-u-ca-gregory' : locale),
    [locale],
  )

  const monthLabel = React.useMemo(() => {
    const format = new Intl.DateTimeFormat(calendarLocale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    return (year: number, month: number) => format.format(new Date(Date.UTC(year, month - 1, 1)))
  }, [calendarLocale])

  /**
   * `narrow`, not `short`: Thai's "short" weekday is the full word — `short`
   * for a Monday is "จันทร์", which does not fit a 30px column and is what
   * turned the header into a smear of overlapping text. `narrow` is "จ".
   */
  const weekdayLabel = React.useMemo(() => {
    const format = new Intl.DateTimeFormat(calendarLocale, { weekday: 'narrow', timeZone: 'UTC' })
    return (iso: string) => format.format(new Date(`${iso}T00:00:00Z`))
  }, [calendarLocale])

  /** Saturday or Sunday, computed in UTC so it cannot drift by a zone. */
  const isWeekend = (iso: string) => {
    const day = new Date(`${iso}T00:00:00Z`).getUTCDay()
    return day === 0 || day === 6
  }

  const save = async (bar: Bar, startDate: string, endDate: string, message: string) => {
    setBusy(true)
    try {
      const res = await apiCall<{ ok: true }>('/api/orva_tasking/tasks', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: bar.task.id, startDate, endDate, updatedAt: bar.task.updatedAt }),
      })
      if (!res.ok || !res.result) {
        throw new Error((res.result as { error?: string } | undefined)?.error ?? t('orva_tasking.saveFailed', 'บันทึกไม่สำเร็จ'))
      }
      setAnnouncement(message)
      await onChanged()
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err), 'error')
    } finally { setBusy(false) }
  }

  /**
   * Move a bar by whole days.
   *
   * A bar with no real dates yet is committed where it lands, which is how an
   * undated task gets onto the calendar: drag it, and the dashed edge goes.
   */
  const shift = async (bar: Bar, days: number) => {
    if (days === 0 && !bar.isUndated) return
    const startDate = addDays(bar.start, days)
    const endDate = addDays(bar.end, days)
    await save(
      bar, startDate, endDate,
      t('orva_tasking.a11y.moved', 'เลื่อน "{title}" ไป {days} วัน')
        .replace('{title}', bar.task.title)
        .replace('{days}', String(days)),
    )
  }

  /** Drag the right edge to change how long a task takes. */
  const resize = async (bar: Bar, days: number) => {
    const endDate = addDays(bar.end, days)
    if (endDate < bar.start) return
    await save(
      bar, bar.start, endDate,
      t('orva_tasking.a11y.resized', 'ปรับ "{title}" เป็น {days} วัน')
        .replace('{title}', bar.task.title)
        .replace('{days}', String(dayIndex(bar.start, endDate) + 1)),
    )
  }

  /**
   * Pointer drag, in whole days.
   *
   * The delta is divided by the day column's own pixel width, so a bar always
   * lands on a day boundary and never between two days.
   */
  const dragBy = (onDrop: (days: number) => void) => (event: React.PointerEvent) => {
    if (busy) return
    event.preventDefault()
    const startX = event.clientX
    let days = 0
    const onMove = (moveEvent: PointerEvent) => {
      days = Math.round((moveEvent.clientX - startX) / DAY_WIDTH)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      onDrop(days)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  if (!today || !range || !span) {
    return <p className="p-4 text-sm text-muted-foreground">…</p>
  }

  const days = dayList(span.from, span.days)
  const defaults = defaultGanttRange(today)
  const isDefaultRange = range.from === defaults.from && range.to === defaults.to
  const todayOffset = dayIndex(span.from, today)
  const todayVisible = todayOffset >= 0 && todayOffset < span.days

  return (
    <div className="space-y-3">
      <p aria-live="polite" className="sr-only">{announcement}</p>

      <div className="flex flex-wrap items-end gap-4 rounded-md border p-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t('orva_tasking.gantt.rangeFrom', 'ช่วงวันที่ จาก')}</span>
          <Input
            type="date"
            className="w-44"
            value={range.from}
            max={range.to}
            onChange={(event) => event.target.value && setRange({ ...range, from: event.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t('orva_tasking.gantt.rangeTo', 'ถึง')}</span>
          <Input
            type="date"
            className="w-44"
            value={range.to}
            min={range.from}
            onChange={(event) => event.target.value && setRange({ ...range, to: event.target.value })}
          />
        </label>
        {/* Only offered once there is something to undo, like Vikunja's. */}
        {!isDefaultRange ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setRange({ from: defaults.from, to: defaults.to })}
          >
            {t('orva_tasking.gantt.resetRange', 'ช่วงเริ่มต้น')}
          </Button>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showUndated}
            onChange={(event) => setShowUndated(event.target.checked)}
          />
          <span>
            {t('orva_tasking.gantt.showUndated', 'แสดงงานที่ไม่มีกำหนดวัน')}
            {undatedCount > 0 ? ` (${undatedCount})` : ''}
          </span>
        </label>
      </div>

      {/*
        The calendar is always drawn, whatever the project holds.

        Half of this install's projects have no task with a date on it, and
        every project starts that way. Swapping the chart for a paragraph of
        text on those made the same view look like two different screens
        depending on which project was picked — and it hid the very calendar
        you need in order to put the first date somewhere. So the frame stays
        and the message goes inside it.
      */}
      {(
        /* Wide content scrolls inside its own container, never the page. */
        <div className="overflow-x-auto rounded-md border">
          <div className="relative w-max">
            {/* Months above, days below — the header Vikunja leads with. */}
            <div className="sticky top-0 z-10 border-b bg-card">
              <div className="flex">
                {monthGroups(span.from, span.days).map((group) => (
                  <div
                    key={group.key}
                    className="border-r py-1 text-center text-sm font-medium last:border-r-0"
                    style={{ width: `${group.days * DAY_WIDTH}px` }}
                  >
                    {monthLabel(group.year, group.month)}
                  </div>
                ))}
              </div>
              <div className="flex border-t">
                {days.map((iso) => (
                  <div
                    key={iso}
                    className="w-8 shrink-0 overflow-hidden border-r last:border-r-0"
                  >
                    <div
                      className={`flex flex-col items-center py-1 text-xs tabular-nums ${
                        iso === today
                          ? 'rounded-t bg-primary font-medium text-primary-foreground'
                          : isWeekend(iso)
                            ? 'text-muted-foreground'
                            : ''
                      }`}
                    >
                      <span>{Number(iso.slice(8, 10))}</span>
                      <span className="text-xs opacity-80">{weekdayLabel(iso)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Height comes from the rows themselves, so the gridlines behind
                them can be one `inset-0` layer with no measured height. */}
            <div className="relative">
              {/* One gridline per day, drawn once behind every row rather than
                  per cell — 70 days times 20 rows of divs is a lot of DOM for
                  a line. */}
              <div aria-hidden="true" className="absolute inset-0 flex">
                {days.map((iso) => (
                  <div
                    key={iso}
                    className={`w-8 shrink-0 border-r last:border-r-0 ${isWeekend(iso) ? 'bg-muted/40' : ''}`}
                  />
                ))}
              </div>

              {todayVisible ? (
                <div
                  aria-hidden="true"
                  className="absolute top-0 bottom-0 w-px bg-primary"
                  style={{ left: `${todayOffset * DAY_WIDTH + DAY_WIDTH / 2}px` }}
                />
              ) : null}

              <ul className="relative">
                {bars.map((bar) => {
                  const offset = dayIndex(span.from, bar.start)
                  const length = dayIndex(bar.start, bar.end) + 1
                  // The bar is exactly as long as the task is. Nothing is
                  // added to make room for the name: a Gantt where a bar is
                  // wider than its dates is a Gantt that lies, and the name
                  // is already carried by the tooltip and the aria-label when
                  // the bar is too short to show it.
                  const barWidth = Math.max(length * DAY_WIDTH, DAY_WIDTH)
                  const fill = bar.isUndated
                    ? 'border border-dashed border-primary bg-primary/20 text-foreground'
                    : bar.task.done
                      ? 'bg-muted-foreground/40 text-foreground'
                      : bar.task.daysOverdue > 0
                        ? 'bg-status-error-solid text-status-error-solid-foreground'
                        : 'bg-primary text-primary-foreground'
                  const label = t('orva_tasking.a11y.bar', '{title} · {from} ถึง {to} · ลูกศรซ้ายขวาเลื่อนวัน')
                    .replace('{title}', bar.task.title)
                    .replace('{from}', bar.start)
                    .replace('{to}', bar.end)
                  return (
                    <li
                      key={bar.task.id}
                      className="relative h-10 border-b border-dashed last:border-b-0"
                    >
                      <div
                        className="absolute top-1 bottom-1"
                        style={{ left: `${offset * DAY_WIDTH}px`, width: `${barWidth}px` }}
                      >
                        <button
                          type="button"
                          disabled={busy}
                          onPointerDown={dragBy((moved) => { void shift(bar, moved) })}
                          onClick={() => onOpenTask(bar.task.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'ArrowLeft') { event.preventDefault(); void shift(bar, -1) }
                            if (event.key === 'ArrowRight') { event.preventDefault(); void shift(bar, 1) }
                          }}
                          aria-label={label}
                          title={label}
                          className={`flex size-full cursor-ew-resize items-center overflow-hidden rounded px-2 text-start text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${fill}`}
                        >
                          <span
                            className={`min-w-0 flex-1 truncate leading-normal ${
                              bar.task.done ? 'line-through opacity-70' : ''
                            }`}
                          >
                            {bar.task.title}
                          </span>
                        </button>

                        {/* An undated bar has no dates to resize yet. */}
                        {!bar.isUndated ? (
                          <span
                            role="slider"
                            tabIndex={0}
                            aria-label={t('orva_tasking.a11y.resizeHandle', 'ปรับความยาวของ "{title}" · ลูกศรซ้ายขวา')
                              .replace('{title}', bar.task.title)}
                            aria-valuenow={length}
                            aria-valuemin={1}
                            aria-valuetext={t('orva_tasking.dayCount', '{n} วัน').replace('{n}', String(length))}
                            onPointerDown={dragBy((moved) => { void resize(bar, moved) })}
                            onKeyDown={(event) => {
                              if (event.key === 'ArrowLeft') { event.preventDefault(); void resize(bar, -1) }
                              if (event.key === 'ArrowRight') { event.preventDefault(); void resize(bar, 1) }
                            }}
                            className="absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>

              {/* Sticky to the left edge so it is readable without scrolling
                  a two-month-wide chart to find it. */}
              {bars.length === 0 ? (
                <div className="relative flex h-24 items-center">
                  <p className="sticky left-0 max-w-md px-4 text-sm text-muted-foreground">
                    {undatedCount > 0
                      ? t('orva_tasking.gantt.undatedHint', 'มีงาน {count} ใบที่ยังไม่ได้ใส่วัน — ติ๊ก "แสดงงานที่ไม่มีกำหนดวัน" แล้วลากมาวางบนปฏิทิน')
                          .replace('{count}', String(undatedCount))
                      : t('orva_tasking.gantt.emptyHint', 'ยังไม่มีงานในโปรเจกต์นี้ — เพิ่มงานด้านล่าง แล้วลากแถบไปวางบนวันที่ต้องการ')}
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          {/* Creating work from the chart, the way Vikunja puts its task form
              under the Gantt: a task added here lands on the calendar with
              dates already on it, which is the only reason to add it here
              rather than in the list. */}
          {onCreate ? (
            <form
              onSubmit={async (event) => {
                event.preventDefault()
                if (!draft.trim() || !today) return
                await onCreate(draft, today, addDays(today, NEW_TASK_SPAN - 1))
                setDraft('')
                draftRef.current?.focus()
              }}
              className="sticky left-0 flex flex-wrap items-center gap-2 border-t bg-muted/40 p-3"
            >
              <Input
                ref={draftRef}
                className="max-w-96 flex-1"
                value={draft}
                maxLength={250}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t('orva_tasking.gantt.newTask', 'เพิ่มงานใหม่…')}
                aria-label={t('orva_tasking.gantt.newTask', 'เพิ่มงานใหม่…')}
              />
              <Button type="submit" disabled={busy || !draft.trim()}>
                {t('orva_tasking.gantt.create', 'สร้างงาน')}
              </Button>
              {/* Says where it will land, so the dates are not a surprise. */}
              <span className="text-xs text-muted-foreground">
                {t('orva_tasking.gantt.createHint', 'เริ่ม {from} ยาว {n} วัน — ลากปรับได้ทีหลัง')
                  .replace('{from}', today)
                  .replace('{n}', String(NEW_TASK_SPAN))}
              </span>
            </form>
          ) : null}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {t('orva_tasking.gantt.hint', 'ลากแถบเพื่อเลื่อนวัน ลากขอบขวาเพื่อปรับความยาว หรือกด Tab ไปที่แถบแล้วใช้ลูกศรซ้ายขวา')}
      </p>
    </div>
  )
}

export default TimelineView
