"use client"
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { BoardTask } from './taskTypes'

export type Bucket = {
  id: string; projectId: string; title: string; position: number
  wipLimit: number; isDoneBucket: boolean; openCount: number; overWip: boolean; updatedAt: string
}

type Held = { taskId: string; bucketId: string; index: number }

/**
 * The board.
 *
 * A custom surface: no installed primitive provides columns you drag cards
 * between. Everything around it stays platform-native — the page shell, the
 * buttons, the flash messages, the semantic tokens.
 *
 * Mouse and keyboard go through the same move call, so the two can never
 * disagree about what a drop does.
 */
export function BoardView({
  projectId,
  tasks,
  onOpenTask,
  onChanged,
}: {
  projectId: string
  tasks: BoardTask[]
  onOpenTask: (id: string) => void
  onChanged: () => Promise<void> | void
}) {
  const t = useT()
  const qc = useQueryClient()
  const [busy, setBusy] = React.useState(false)
  const [held, setHeld] = React.useState<Held | null>(null)
  const [announcement, setAnnouncement] = React.useState('')
  const [addingTo, setAddingTo] = React.useState<string | null>(null)
  const [newTitle, setNewTitle] = React.useState('')
  const [newColumn, setNewColumn] = React.useState('')

  const buckets = useQuery({
    queryKey: ['orva_tasking.buckets', projectId],
    queryFn: async () =>
      (await readApiResultOrThrow<{ items: Bucket[] }>(`/api/orva_tasking/buckets?projectId=${projectId}`)).items,
  })

  const send = async (path: string, method: 'POST' | 'PUT' | 'DELETE', body: Record<string, unknown>) => {
    setBusy(true)
    try {
      const res = await apiCall<{ ok: true; wip?: { over: boolean; limit: number } }>(path, {
        method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok || !res.result) {
        throw new Error((res.result as { error?: string } | undefined)?.error ?? t('orva_tasking.saveFailed', 'บันทึกไม่สำเร็จ'))
      }
      return res.result
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err), 'error')
      return null
    } finally { setBusy(false) }
  }

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['orva_tasking.buckets', projectId] })
    await onChanged()
  }

  const cardsIn = React.useCallback(
    (bucketId: string) => tasks.filter((task) => task.bucketId === bucketId),
    [tasks],
  )
  // Work written down before the project had a board. Shown in the first
  // column rather than hidden, so a new board never looks empty when it is not.
  const unplaced = tasks.filter((task) => !task.bucketId)

  const move = async (taskId: string, bucketId: string, index: number) => {
    const task = tasks.find((candidate) => candidate.id === taskId)
    if (!task) return
    const result = await send('/api/orva_tasking/tasks/position', 'PUT', {
      id: taskId, bucketId, index, updatedAt: task.updatedAt,
    })
    if (result?.wip?.over) {
      flash(
        t('orva_tasking.overWip', 'คอลัมน์นี้เกินลิมิต {limit} งานแล้ว').replace('{limit}', String(result.wip.limit)),
        'info',
      )
    }
    await refresh()
  }

  const createDefaults = async () => {
    const ok = await send('/api/orva_tasking/buckets/defaults', 'POST', {
      projectId,
      titles: [
        t('orva_tasking.bucket.todo', 'รอทำ'),
        t('orva_tasking.bucket.doing', 'กำลังทำ'),
        t('orva_tasking.bucket.done', 'เสร็จ'),
      ],
    })
    if (ok) await refresh()
  }

  const addColumn = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!newColumn.trim()) return
    const ok = await send('/api/orva_tasking/buckets', 'POST', { projectId, title: newColumn })
    if (ok) { setNewColumn(''); await refresh() }
  }

  const addCard = async (bucketId: string, event: React.FormEvent) => {
    event.preventDefault()
    if (!newTitle.trim()) return
    const created = await send('/api/orva_tasking/tasks', 'POST', { projectId, title: newTitle })
    if (!created) return
    const id = (created as unknown as { id?: string }).id
    setNewTitle('')
    setAddingTo(null)
    if (id) {
      // Two calls because creating a task does not know about boards; placing
      // it is the board's business. The card lands where it was typed.
      await send('/api/orva_tasking/tasks/position', 'PUT', {
        id, bucketId, index: 9999, updatedAt: new Date().toISOString(),
      })
    }
    await refresh()
  }

  const removeColumn = async (bucket: Bucket) => {
    const count = cardsIn(bucket.id).length
    const question = count
      ? t('orva_tasking.confirmDeleteColumnWithCards', 'ลบคอลัมน์ "{title}" ไหม การ์ด {count} ใบจะย้ายไปคอลัมน์แรก')
        .replace('{title}', bucket.title).replace('{count}', String(count))
      : t('orva_tasking.confirmDeleteColumn', 'ลบคอลัมน์ "{title}" ไหม').replace('{title}', bucket.title)
    if (!window.confirm(question)) return
    const ok = await send('/api/orva_tasking/buckets', 'DELETE', { id: bucket.id })
    if (ok) await refresh()
  }

  const setWip = async (bucket: Bucket) => {
    const raw = window.prompt(
      t('orva_tasking.askWip', 'จำกัดงานที่ทำค้างในคอลัมน์นี้กี่ใบ (0 = ไม่จำกัด)'),
      String(bucket.wipLimit),
    )
    if (raw === null) return
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 0 || value > 999) {
      flash(t('orva_tasking.badWip', 'ใส่จำนวนเต็ม 0–999'), 'error')
      return
    }
    const ok = await send('/api/orva_tasking/buckets', 'PUT', {
      id: bucket.id, wipLimit: value, updatedAt: bucket.updatedAt,
    })
    if (ok) await refresh()
  }

  /**
   * Keyboard moves, in full parity with the mouse.
   *
   * Space picks a card up, arrows move it, Space drops it, Escape puts it
   * back. A board that can only be used with a mouse is a board half the team
   * cannot use.
   */
  const onCardKeyDown = async (event: React.KeyboardEvent, task: BoardTask, bucketId: string, index: number) => {
    const list = buckets.data ?? []
    const columnIndex = list.findIndex((bucket) => bucket.id === bucketId)

    if (event.key === 'Enter') {
      event.preventDefault()
      onOpenTask(task.id)
      return
    }
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault()
      if (!held) {
        setHeld({ taskId: task.id, bucketId, index })
        setAnnouncement(t('orva_tasking.a11y.picked', 'ยก "{title}" ขึ้นแล้ว ใช้ลูกศรย้าย เว้นวรรคเพื่อวาง')
          .replace('{title}', task.title))
      } else {
        const target = held
        setHeld(null)
        setAnnouncement(t('orva_tasking.a11y.dropped', 'วาง "{title}" แล้ว').replace('{title}', task.title))
        await move(target.taskId, target.bucketId, target.index)
      }
      return
    }
    if (event.key === 'Escape' && held) {
      event.preventDefault()
      setHeld(null)
      setAnnouncement(t('orva_tasking.a11y.cancelled', 'ยกเลิกการย้าย'))
      return
    }
    if (!held || held.taskId !== task.id) return

    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
    if (!arrows.includes(event.key)) return
    event.preventDefault()

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const nextColumn = list[columnIndex + (event.key === 'ArrowRight' ? 1 : -1)]
      if (!nextColumn) return
      setHeld({ ...held, bucketId: nextColumn.id, index: cardsIn(nextColumn.id).length })
      setAnnouncement(t('orva_tasking.a11y.toColumn', 'ย้ายไปคอลัมน์ {title}').replace('{title}', nextColumn.title))
      return
    }
    const delta = event.key === 'ArrowDown' ? 1 : -1
    const size = cardsIn(held.bucketId).length
    const next = Math.max(0, Math.min(held.index + delta, size))
    setHeld({ ...held, index: next })
    setAnnouncement(t('orva_tasking.a11y.toPosition', 'ตำแหน่งที่ {n}').replace('{n}', String(next + 1)))
  }

  if (buckets.isLoading) {
    return <p className="text-sm text-muted-foreground">…</p>
  }

  if (buckets.error) {
    return (
      <div className="rounded-md border p-4">
        <p className="text-sm text-status-error-text">{t('orva_tasking.boardLoadFailed', 'โหลดบอร์ดไม่สำเร็จ')}</p>
        <Button className="mt-2" variant="outline" onClick={() => buckets.refetch()}>
          {t('orva_tasking.retry', 'ลองอีกครั้ง')}
        </Button>
      </div>
    )
  }

  if ((buckets.data ?? []).length === 0) {
    return (
      <div className="rounded-md border p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {t('orva_tasking.noBuckets', 'ยังไม่มีคอลัมน์ — สร้างชุดเริ่มต้น (รอทำ · กำลังทำ · เสร็จ)')}
        </p>
        <Button className="mt-3" onClick={createDefaults} disabled={busy}>
          {t('orva_tasking.createBoard', 'สร้างบอร์ด')}
        </Button>
        {unplaced.length > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t('orva_tasking.willPlace', 'งาน {count} ใบที่มีอยู่จะถูกจัดลงคอลัมน์ให้')
              .replace('{count}', String(unplaced.length))}
          </p>
        ) : null}
      </div>
    )
  }

  const list = buckets.data ?? []

  return (
    <div className="space-y-3">
      <p aria-live="polite" className="sr-only">{announcement}</p>

      {/* The columns scroll, never the page. */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {list.map((bucket, columnIndex) => {
          const cards = columnIndex === 0 ? [...cardsIn(bucket.id), ...unplaced] : cardsIn(bucket.id)
          return (
            <section
              key={bucket.id}
              className="flex w-72 shrink-0 flex-col rounded-lg border bg-card"
              onDragOver={(event) => event.preventDefault()}
              onDrop={async (event) => {
                event.preventDefault()
                const taskId = event.dataTransfer.getData('text/plain')
                if (taskId) await move(taskId, bucket.id, cards.length)
              }}
            >
              <header className="flex items-center gap-2 border-b px-3 py-2">
                <h3 className="truncate text-sm font-medium">{bucket.title}</h3>
                <span className={`tabular-nums text-xs ${bucket.overWip ? 'text-status-error-text' : 'text-muted-foreground'}`}>
                  {bucket.openCount}{bucket.wipLimit > 0 ? `/${bucket.wipLimit}` : ''}
                </span>
                {bucket.overWip ? (
                  <span className="rounded bg-status-error-bg px-1.5 text-xs text-status-error-text">
                    {t('orva_tasking.wipExceeded', 'เกินลิมิต')}
                  </span>
                ) : null}
                {bucket.isDoneBucket ? (
                  <span className="rounded bg-muted px-1.5 text-xs">{t('orva_tasking.doneColumn', 'เสร็จ')}</span>
                ) : null}
                <span className="ml-auto flex gap-1">
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setWip(bucket)}>
                    {t('orva_tasking.wip', 'ลิมิต')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => removeColumn(bucket)}>
                    {t('orva_tasking.delete', 'ลบ')}
                  </Button>
                </span>
              </header>

              <ul className="flex-1 space-y-2 p-2">
                {cards.length === 0 ? (
                  <li className="px-1 py-6 text-center text-xs text-muted-foreground">
                    {t('orva_tasking.emptyColumn', 'ว่าง')}
                  </li>
                ) : null}
                {cards.map((task, index) => {
                  const isHeld = held?.taskId === task.id
                  return (
                    <li key={task.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        draggable
                        onDragStart={(event) => event.dataTransfer.setData('text/plain', task.id)}
                        onClick={() => onOpenTask(task.id)}
                        onKeyDown={(event) => onCardKeyDown(event, task, bucket.id, index)}
                        aria-label={t('orva_tasking.a11y.card', '{title} · คอลัมน์ {column} · ตำแหน่งที่ {n}')
                          .replace('{title}', task.title)
                          .replace('{column}', bucket.title)
                          .replace('{n}', String(index + 1))}
                        className={`w-full cursor-grab rounded-md border bg-background p-2 text-left text-sm hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isHeld ? 'ring-2 ring-ring' : ''}`}
                      >
                        <span className={task.done ? 'text-muted-foreground line-through' : ''}>{task.title}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                          {task.dueOn ? (
                            <span className={task.daysOverdue > 0 ? 'text-status-error-text' : ''}>{task.dueOn}</span>
                          ) : null}
                          {task.percentDone > 0 && !task.done ? <span>{task.percentDone}%</span> : null}
                          {task.labels.map((label) => (
                            <span key={label.id} className="rounded-full border px-1.5">
                              <span
                                aria-hidden="true"
                                className="mr-1 inline-block size-2 rounded-full align-middle"
                                style={{ backgroundColor: label.hexColor }}
                              />
                              {label.title}
                            </span>
                          ))}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>

              <footer className="border-t p-2">
                {addingTo === bucket.id ? (
                  <form onSubmit={(event) => addCard(bucket.id, event)} className="flex gap-1">
                    <Input
                      autoFocus
                      value={newTitle}
                      maxLength={250}
                      onChange={(event) => setNewTitle(event.target.value)}
                      aria-label={t('orva_tasking.newTask', 'เพิ่มงานใหม่…')}
                    />
                    <Button type="submit" size="sm" disabled={busy || !newTitle.trim()}>
                      {t('orva_tasking.add', 'เพิ่ม')}
                    </Button>
                  </form>
                ) : (
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setAddingTo(bucket.id); setNewTitle('') }}>
                    {t('orva_tasking.addCard', '+ เพิ่มงาน')}
                  </Button>
                )}
              </footer>
            </section>
          )
        })}

        <form onSubmit={addColumn} className="flex w-56 shrink-0 flex-col gap-2 rounded-lg border border-dashed p-3">
          <Input
            value={newColumn}
            maxLength={80}
            onChange={(event) => setNewColumn(event.target.value)}
            placeholder={t('orva_tasking.newColumn', 'คอลัมน์ใหม่…')}
            aria-label={t('orva_tasking.newColumn', 'คอลัมน์ใหม่…')}
          />
          <Button type="submit" variant="outline" size="sm" disabled={busy || !newColumn.trim()}>
            {t('orva_tasking.create', 'สร้าง')}
          </Button>
        </form>
      </div>

      <p className="text-xs text-muted-foreground">
        {t('orva_tasking.boardHint', 'ลากการ์ดได้ หรือกด Tab ไปที่การ์ดแล้วกดเว้นวรรคเพื่อยก · ลูกศรย้าย · เว้นวรรควาง · Esc ยกเลิก')}
      </p>
    </div>
  )
}

export default BoardView
