"use client"
import * as React from 'react'
import { AlignLeft, Link2, MessageSquare, Repeat } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { BoardTask } from './taskTypes'

/**
 * The list — Vikunja's default view, which this module was missing.
 *
 * The table answers "which of these" by sorting and filtering columns. The
 * list answers "what is next" by putting one task on one line: tick it off,
 * read it, or click into it. Vikunja leads with this view because most days
 * that is the whole job, and a table makes you read five columns to find the
 * one that matters.
 *
 * The row follows Vikunja's own order — checkbox, priority, title, labels,
 * assignee, due date, then icons standing in for what the task carries — so
 * the shape is learnable by anyone who has used Vikunja. Tasks arrive already
 * ordered by the API (unfinished first, soonest due, then priority), so there
 * is no sort control: the order is the answer to "what is next".
 */

/** Vikunja shows a priority flag only from High up; below that it is noise. */
const PRIORITY_SHOWN_FROM = 3

export function TaskListView({
  tasks,
  isLoading,
  error,
  assignees,
  showDone,
  onShowDoneChange,
  onOpenTask,
  onToggleDone,
  onQuickAdd,
  busy,
  canAdd,
}: {
  tasks: BoardTask[]
  isLoading: boolean
  error: string | null
  assignees: { id: string; name: string }[]
  showDone: boolean
  onShowDoneChange: (next: boolean) => void
  onOpenTask: (id: string) => void
  onToggleDone: (task: BoardTask) => void
  onQuickAdd: (title: string, dueOn: string) => Promise<void>
  busy: boolean
  canAdd: boolean
}) {
  const t = useT()
  const [title, setTitle] = React.useState('')
  const [dueOn, setDueOn] = React.useState('')
  const addRef = React.useRef<HTMLInputElement>(null)

  /**
   * Today, read after mount only.
   *
   * "ครบกำหนดในอีก 3 วัน" is the phrasing Vikunja is known for, and it cannot
   * be rendered on the server: the server's clock and the reader's differ, and
   * the mismatch shows up as a hydration error. Until this is set the row
   * shows the plain date, which is correct at every moment.
   */
  const [today, setToday] = React.useState<string | null>(null)
  React.useEffect(() => {
    const now = new Date()
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    setToday(local.toISOString().slice(0, 10))
  }, [])

  const priorityLabel = (priority: number) => (
    priority >= 4
      ? t('orva_tasking.priority.urgent', 'ด่วน')
      : t('orva_tasking.priority.high', 'สูง')
  )

  /** "เลย 2 วัน" / "ครบกำหนดวันนี้" / "อีก 3 วัน" / the bare date before mount. */
  const dueText = (task: BoardTask) => {
    if (!task.dueOn) return null
    // A finished task keeps its date but loses the countdown: "อีก 5 วัน"
    // beside a ticked-off row reads as work still to come.
    if (task.done) return task.dueOn
    if (task.daysOverdue > 0) {
      return t('orva_tasking.overdue', 'เลย {days} วัน').replace('{days}', String(task.daysOverdue))
    }
    if (!today) return task.dueOn
    const days = Math.round(
      (Date.parse(`${task.dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
    )
    if (days <= 0) return t('orva_tasking.dueToday', 'ครบกำหนดวันนี้')
    if (days === 1) return t('orva_tasking.dueTomorrow', 'ครบกำหนดพรุ่งนี้')
    return t('orva_tasking.dueInDays', 'อีก {n} วัน').replace('{n}', String(days))
  }

  const assigneeName = (id: string | null) =>
    (id ? assignees.find((person) => person.id === id)?.name ?? null : null)

  return (
    <div className="overflow-hidden rounded-md border">
      {canAdd ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            if (!title.trim()) return
            await onQuickAdd(title, dueOn)
            setTitle('')
            setDueOn('')
            // Vikunja keeps the caret in the box so a list can be typed out in
            // one go, rather than clicking back into it for every task.
            addRef.current?.focus()
          }}
          className="flex flex-wrap items-center gap-2 border-b bg-muted/40 p-3"
        >
          <Input
            ref={addRef}
            className="max-w-96 flex-1"
            value={title}
            maxLength={250}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('orva_tasking.newTask', 'เพิ่มงานใหม่…')}
            aria-label={t('orva_tasking.newTask', 'เพิ่มงานใหม่…')}
          />
          <Input
            type="date"
            className="w-44"
            value={dueOn}
            onChange={(event) => setDueOn(event.target.value)}
            aria-label={t('orva_tasking.col.due', 'กำหนดเสร็จ')}
          />
          <Button type="submit" disabled={busy || !title.trim()}>{t('orva_tasking.add', 'เพิ่ม')}</Button>
        </form>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(event) => onShowDoneChange(event.target.checked)}
          />
          {t('orva_tasking.showDone', 'แสดงงานที่เสร็จแล้ว')}
        </label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {t('orva_tasking.upcoming.taskCount', '{n} งาน').replace('{n}', String(tasks.length))}
        </span>
      </div>

      {isLoading ? <p className="p-4 text-sm text-muted-foreground">…</p> : null}
      {error ? <p className="p-4 text-sm text-status-error-text">{error}</p> : null}

      {!isLoading && !error && tasks.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {t('orva_tasking.empty', 'ยังไม่มีงานค้างในโปรเจกต์นี้')}
          </p>
          {canAdd ? (
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={() => addRef.current?.focus()}
            >
              {t('orva_tasking.newTaskCta', 'เพิ่มงานแรก')}
            </Button>
          ) : null}
        </div>
      ) : null}

      <ul>
        {tasks.map((task) => {
          const assignee = assigneeName(task.assigneeUserId)
          const due = dueText(task)
          return (
            <li key={task.id} className="border-b last:border-b-0">
              {/* The whole row opens the task, the way Vikunja's does. It is a
                  button so the keyboard and a screen reader get the same
                  affordance the mouse has; the checkbox sits outside it
                  because ticking a task off must not also open it. */}
              <div className="flex items-start gap-2 px-3 py-2 hover:bg-muted">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={task.done}
                  disabled={busy}
                  onChange={() => onToggleDone(task)}
                  aria-label={t('orva_tasking.toggle', 'ทำเครื่องหมายว่าเสร็จ')}
                />
                <button
                  type="button"
                  onClick={() => onOpenTask(task.id)}
                  className="flex flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-start text-sm"
                >
                  {/* สูง and ด่วน are different answers, so they get different
                      colours — one pill for both would make the flag useless
                      on a project where most work is สูง. */}
                  {task.priority >= PRIORITY_SHOWN_FROM && !task.done ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        task.priority >= 4
                          ? 'bg-status-error-bg text-status-error-text'
                          : 'bg-status-warning-bg text-status-warning-text'
                      }`}
                    >
                      {priorityLabel(task.priority)}
                    </span>
                  ) : null}

                  <span className={task.done ? 'text-muted-foreground line-through' : 'font-medium'}>
                    {task.title}
                  </span>

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

                  {assignee ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {assignee}
                    </span>
                  ) : null}

                  {due ? (
                    <time
                      dateTime={task.dueOn ?? undefined}
                      title={task.dueOn ?? undefined}
                      className={`text-xs italic tabular-nums ${
                        task.daysOverdue > 0 ? 'text-status-error-text' : 'text-muted-foreground'
                      }`}
                    >
                      {due}
                    </time>
                  ) : null}

                  {/* What the task carries, without opening it — the same four
                      hints Vikunja puts at the end of the row. */}
                  <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                    {task.percentDone > 0 && !task.done ? (
                      <span className="tabular-nums">{task.percentDone}%</span>
                    ) : null}
                    {task.description ? (
                      <AlignLeft
                        className="size-3.5"
                        aria-label={t('orva_tasking.hasDescription', 'มีรายละเอียด')}
                      />
                    ) : null}
                    {task.commentCount > 0 ? (
                      <span className="flex items-center gap-0.5">
                        <MessageSquare className="size-3.5" aria-hidden="true" />
                        <span className="tabular-nums">{task.commentCount}</span>
                        <span className="sr-only">{t('orva_tasking.col.comments', 'คอมเมนต์')}</span>
                      </span>
                    ) : null}
                    {task.relationCount > 0 ? (
                      <span className="flex items-center gap-0.5">
                        <Link2 className="size-3.5" aria-hidden="true" />
                        <span className="tabular-nums">{task.relationCount}</span>
                        <span className="sr-only">{t('orva_tasking.col.relations', 'งานที่เกี่ยวข้อง')}</span>
                      </span>
                    ) : null}
                    {task.repeatEveryDays ? (
                      <Repeat
                        className="size-3.5"
                        aria-label={t('orva_tasking.isRepeating', 'งานที่ทำซ้ำ')}
                      />
                    ) : null}
                  </span>
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default TaskListView
