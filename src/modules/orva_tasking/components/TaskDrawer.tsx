"use client"
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@open-mercato/ui/primitives/drawer'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { AttachmentsSection } from '@open-mercato/ui/backend/detail/AttachmentsSection'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/** How the attachments module addresses a task's files. */
export const TASK_ATTACHMENT_ENTITY_ID = 'orva_tasking:task'

export type DrawerTask = {
  id: string; projectId: string; title: string; description: string | null
  done: boolean; dueOn: string | null; startDate: string | null; endDate: string | null
  percentDone: number; priority: number; identifier: string
  labels: { id: string; title: string; hexColor: string }[]
  updatedAt: string
}

type Label = { id: string; title: string; hexColor: string; usageCount: number; updatedAt: string }
type Comment = {
  id: string; body: string; authorName: string | null; isCustomerVisible: boolean
  isFromCustomer: boolean; editedAt: string | null; createdAt: string
}
type Relation = { otherTaskId: string; kind: string; title: string; done: boolean; identifier: string }
type SiblingTask = { id: string; title: string; identifier: string }

const RELATION_KINDS = ['subtask', 'blocks', 'related'] as const

/**
 * Everything about one task, in the place the user clicked it.
 *
 * A drawer rather than a page: planning is a scanning activity, and losing the
 * list to look at one row costs more than the extra width saves.
 */
export function TaskDrawer({
  task,
  onClose,
  onSaved,
}: {
  task: DrawerTask | null
  onClose: () => void
  onSaved: () => void
}) {
  const t = useT()
  const qc = useQueryClient()
  const [draft, setDraft] = React.useState<DrawerTask | null>(task)
  const [comment, setComment] = React.useState('')
  const [commentVisible, setCommentVisible] = React.useState(false)
  const [relationKind, setRelationKind] = React.useState<(typeof RELATION_KINDS)[number]>('subtask')
  const [relationTarget, setRelationTarget] = React.useState('')
  const [newLabel, setNewLabel] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => { setDraft(task) }, [task])

  const open = Boolean(task)
  const taskId = task?.id ?? null

  const labels = useQuery({
    queryKey: ['orva_tasking.labels'],
    queryFn: async () => (await readApiResultOrThrow<{ items: Label[] }>('/api/orva_tasking/labels')).items,
    enabled: open,
  })
  const comments = useQuery({
    queryKey: ['orva_tasking.comments', taskId],
    queryFn: async () => (await readApiResultOrThrow<{ items: Comment[] }>(`/api/orva_tasking/comments?taskId=${taskId!}`)).items,
    enabled: open && Boolean(taskId),
  })
  const relations = useQuery({
    queryKey: ['orva_tasking.relations', taskId],
    queryFn: async () => (await readApiResultOrThrow<{ items: Relation[] }>(`/api/orva_tasking/relations?taskId=${taskId!}`)).items,
    enabled: open && Boolean(taskId),
  })
  const siblings = useQuery({
    queryKey: ['orva_tasking.tasks.siblings', task?.projectId],
    queryFn: async () => {
      const res = await readApiResultOrThrow<{ items: SiblingTask[] }>(
        `/api/orva_tasking/tasks?projectId=${task!.projectId}&bucket=all`,
      )
      return res.items.filter((item) => item.id !== taskId)
    },
    enabled: open && Boolean(task?.projectId),
  })

  const send = async (path: string, method: 'POST' | 'PUT' | 'DELETE', body: Record<string, unknown>) => {
    setBusy(true)
    try {
      const res = await apiCall<{ ok: true }>(path, {
        method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok || !res.result) {
        throw new Error((res.result as { error?: string } | undefined)?.error ?? t('orva_tasking.saveFailed', 'บันทึกไม่สำเร็จ'))
      }
      return true
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err), 'error')
      return false
    } finally { setBusy(false) }
  }

  const saveTask = async () => {
    if (!draft || !task) return
    const ok = await send('/api/orva_tasking/tasks', 'PUT', {
      id: draft.id,
      title: draft.title,
      description: draft.description,
      dueOn: draft.dueOn || null,
      startDate: draft.startDate || null,
      endDate: draft.endDate || null,
      percentDone: draft.percentDone,
      priority: draft.priority,
      labelIds: draft.labels.map((label) => label.id),
      updatedAt: task.updatedAt,
    })
    if (ok) {
      flash(t('orva_tasking.saved', 'บันทึกแล้ว'), 'success')
      onSaved()
      onClose()
    }
  }

  const toggleLabel = (label: Label) => {
    setDraft((current) => {
      if (!current) return current
      const has = current.labels.some((existing) => existing.id === label.id)
      return {
        ...current,
        labels: has
          ? current.labels.filter((existing) => existing.id !== label.id)
          : [...current.labels, { id: label.id, title: label.title, hexColor: label.hexColor }],
      }
    })
  }

  const addLabel = async (event: React.FormEvent) => {
    event.preventDefault()
    const title = newLabel.trim()
    if (!title) return
    const ok = await send('/api/orva_tasking/labels', 'POST', { title })
    if (ok) {
      setNewLabel('')
      // Apply it straight away: nobody creates a label in order not to use it.
      const refreshed = await qc.fetchQuery({
        queryKey: ['orva_tasking.labels'],
        queryFn: async () => (await readApiResultOrThrow<{ items: Label[] }>('/api/orva_tasking/labels')).items,
      })
      const created = refreshed.find((label) => label.title === title)
      if (created) toggleLabel(created)
    }
  }

  const addComment = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!taskId || !comment.trim()) return
    const ok = await send('/api/orva_tasking/comments', 'POST', {
      taskId, body: comment, isCustomerVisible: commentVisible,
    })
    if (ok) {
      setComment('')
      setCommentVisible(false)
      await qc.invalidateQueries({ queryKey: ['orva_tasking.comments', taskId] })
    }
  }

  const addRelation = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!taskId || !relationTarget) return
    const ok = await send('/api/orva_tasking/relations', 'POST', {
      taskId, otherTaskId: relationTarget, kind: relationKind,
    })
    if (ok) {
      setRelationTarget('')
      await qc.invalidateQueries({ queryKey: ['orva_tasking.relations', taskId] })
    }
  }

  const removeRelation = async (otherTaskId: string) => {
    if (!taskId) return
    const ok = await send('/api/orva_tasking/relations', 'DELETE', { taskId, otherTaskId })
    if (ok) await qc.invalidateQueries({ queryKey: ['orva_tasking.relations', taskId] })
  }

  const kindLabel = (kind: string) => ({
    subtask: t('orva_tasking.rel.subtask', 'งานย่อย'),
    parent: t('orva_tasking.rel.parent', 'อยู่ใต้'),
    blocks: t('orva_tasking.rel.blocks', 'ติดขัดงานนี้'),
    blocked_by: t('orva_tasking.rel.blockedBy', 'รอ'),
    related: t('orva_tasking.rel.related', 'เกี่ยวข้อง'),
  }[kind] ?? kind)

  if (!draft || !task) return null

  return (
    <Drawer open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DrawerContent className="max-w-3xl">
        <DrawerHeader>
          <DrawerTitle>{draft.title}</DrawerTitle>
          <DrawerDescription>{draft.identifier}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium" htmlFor="task-title">
              {t('orva_tasking.field.title', 'ชื่องาน')}
            </label>
            <Input
              id="task-title"
              value={draft.title}
              maxLength={250}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <label className="block text-sm font-medium" htmlFor="task-start">{t('orva_tasking.field.start', 'วันเริ่ม')}</label>
              <Input id="task-start" type="date" value={draft.startDate ?? ''} onChange={(e) => setDraft({ ...draft, startDate: e.target.value || null })} />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium" htmlFor="task-end">{t('orva_tasking.field.end', 'วันจบ')}</label>
              <Input id="task-end" type="date" value={draft.endDate ?? ''} onChange={(e) => setDraft({ ...draft, endDate: e.target.value || null })} />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium" htmlFor="task-due">{t('orva_tasking.col.due', 'กำหนดเสร็จ')}</label>
              <Input id="task-due" type="date" value={draft.dueOn ?? ''} onChange={(e) => setDraft({ ...draft, dueOn: e.target.value || null })} />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium" htmlFor="task-percent">{t('orva_tasking.field.percent', 'คืบหน้า %')}</label>
              <Input
                id="task-percent"
                type="number"
                min={0}
                max={100}
                value={draft.percentDone}
                onChange={(e) => setDraft({ ...draft, percentDone: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
              />
            </div>
          </div>
          {draft.startDate && draft.endDate && draft.startDate > draft.endDate ? (
            <p className="text-sm text-status-error-text" role="alert">
              {t('orva_tasking.datesOutOfOrder', 'วันเริ่มต้องไม่หลังวันจบ')}
            </p>
          ) : null}

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('orva_tasking.field.labels', 'ป้ายกำกับ')}</legend>
            {labels.isLoading ? <p className="text-sm text-muted-foreground">…</p> : null}
            {labels.data?.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('orva_tasking.noLabels', 'ยังไม่มีป้ายกำกับ')}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {(labels.data ?? []).map((label) => {
                const active = draft.labels.some((existing) => existing.id === label.id)
                return (
                  <button
                    key={label.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleLabel(label)}
                    className={`rounded-full border px-3 py-1 text-sm ${active ? 'bg-muted font-medium' : 'hover:bg-muted'}`}
                  >
                    <span
                      aria-hidden="true"
                      className="mr-1.5 inline-block size-2 rounded-full align-middle"
                      style={{ backgroundColor: label.hexColor }}
                    />
                    {label.title}
                  </button>
                )
              })}
            </div>
            {/* Created here rather than on a settings page: a label is almost
                always invented at the moment it is first needed. */}
            <form onSubmit={addLabel} className="flex flex-wrap items-end gap-2 pt-1">
              <Input
                className="w-48"
                value={newLabel}
                maxLength={60}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder={t('orva_tasking.newLabel', 'ป้ายใหม่…')}
                aria-label={t('orva_tasking.newLabel', 'ป้ายใหม่…')}
              />
              <Button type="submit" variant="outline" size="sm" disabled={busy || !newLabel.trim()}>
                {t('orva_tasking.create', 'สร้าง')}
              </Button>
            </form>
          </fieldset>

          <div className="space-y-2">
            <label className="block text-sm font-medium" htmlFor="task-description">
              {t('orva_tasking.field.description', 'รายละเอียด')}
            </label>
            <Textarea
              id="task-description"
              rows={4}
              maxLength={8000}
              value={draft.description ?? ''}
              onChange={(e) => setDraft({ ...draft, description: e.target.value || null })}
            />
          </div>

          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t('orva_tasking.field.relations', 'งานที่เกี่ยวข้อง')}</h3>
            {relations.data?.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('orva_tasking.noRelations', 'ยังไม่ได้เชื่อมกับงานอื่น')}</p>
            ) : null}
            <ul className="space-y-1">
              {(relations.data ?? []).map((relation) => (
                <li key={`${relation.kind}-${relation.otherTaskId}`} className="flex items-center gap-2 text-sm">
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{kindLabel(relation.kind)}</span>
                  <span className={relation.done ? 'text-muted-foreground line-through' : ''}>{relation.title}</span>
                  <span className="text-xs text-muted-foreground">{relation.identifier}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    disabled={busy}
                    onClick={() => removeRelation(relation.otherTaskId)}
                  >
                    {t('orva_tasking.unlink', 'เอาออก')}
                  </Button>
                </li>
              ))}
            </ul>
            <form onSubmit={addRelation} className="flex flex-wrap items-end gap-2">
              <select
                aria-label={t('orva_tasking.field.relationKind', 'ความสัมพันธ์')}
                className="rounded-md border bg-background px-3 py-2 text-sm"
                value={relationKind}
                onChange={(e) => setRelationKind(e.target.value as (typeof RELATION_KINDS)[number])}
              >
                {RELATION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>{kindLabel(kind)}</option>
                ))}
              </select>
              <select
                aria-label={t('orva_tasking.field.relationTarget', 'งานปลายทาง')}
                className="min-w-48 rounded-md border bg-background px-3 py-2 text-sm"
                value={relationTarget}
                onChange={(e) => setRelationTarget(e.target.value)}
              >
                <option value="">{t('orva_tasking.pickTask', '— เลือกงาน —')}</option>
                {(siblings.data ?? []).map((sibling) => (
                  <option key={sibling.id} value={sibling.id}>{sibling.title}</option>
                ))}
              </select>
              <Button type="submit" variant="outline" disabled={busy || !relationTarget}>
                {t('orva_tasking.link', 'เชื่อม')}
              </Button>
            </form>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t('orva_tasking.field.comments', 'คอมเมนต์')}</h3>
            {comments.isLoading ? <p className="text-sm text-muted-foreground">…</p> : null}
            {comments.data?.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('orva_tasking.noComments', 'ยังไม่มีคอมเมนต์')}</p>
            ) : null}
            <ul className="space-y-3">
              {(comments.data ?? []).map((item) => (
                <li key={item.id} className="rounded-md border p-3 text-sm">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{item.authorName ?? t('orva_tasking.unknownAuthor', 'ไม่ทราบผู้เขียน')}</span>
                    <span>{item.createdAt.slice(0, 16).replace('T', ' ')}</span>
                    {item.editedAt ? <span>{t('orva_tasking.edited', 'แก้ไขแล้ว')}</span> : null}
                    {item.isCustomerVisible ? (
                      <span className="rounded bg-muted px-1.5 py-0.5">{t('orva_tasking.customerCanSee', 'ลูกค้าเห็น')}</span>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap">{item.body}</p>
                </li>
              ))}
            </ul>
            <form onSubmit={addComment} className="space-y-2">
              <Textarea
                rows={3}
                maxLength={8000}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t('orva_tasking.commentPlaceholder', 'เขียนคอมเมนต์…')}
                aria-label={t('orva_tasking.field.comments', 'คอมเมนต์')}
              />
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={commentVisible} onChange={(e) => setCommentVisible(e.target.checked)} />
                  {t('orva_tasking.markCustomerVisible', 'ให้ลูกค้าเห็นคอมเมนต์นี้')}
                </label>
                <Button type="submit" variant="outline" disabled={busy || !comment.trim()}>
                  {t('orva_tasking.addComment', 'เพิ่มคอมเมนต์')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('orva_tasking.commentPrivacyHint', 'คอมเมนต์เป็นบันทึกภายในเสมอ จนกว่าจะติ๊กให้ลูกค้าเห็น')}
              </p>
            </form>
          </section>

          <AttachmentsSection
            entityId={TASK_ATTACHMENT_ENTITY_ID}
            recordId={draft.id}
            title={t('orva_tasking.field.files', 'ไฟล์แนบ')}
            compact
          />
        </DrawerBody>
        <DrawerFooter>
          <Button type="button" onClick={saveTask} disabled={busy}>{t('orva_tasking.save', 'บันทึก')}</Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t('orva_tasking.cancel', 'ยกเลิก')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

export default TaskDrawer
