"use client"
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { TaskDrawer } from './TaskDrawer'

type Project = {
  id: string; name: string; description: string | null
  quoteId: string | null; quoteNumber: string | null; isArchived: boolean
  total: number; done: number; donePct: number; overdue: number; updatedAt: string
}
type Task = {
  id: string; projectId: string; title: string; description: string | null
  done: boolean; doneAt: string | null; dueOn: string | null
  startDate: string | null; endDate: string | null
  percentDone: number; identifier: string
  labels: { id: string; title: string; hexColor: string }[]
  commentCount: number; relationCount: number
  daysOverdue: number; priority: number; updatedAt: string
}
type QuoteOption = { quoteId: string; quoteNumber: string; customerName: string | null }

/**
 * งาน — work tracked beside the money it bills against.
 *
 * Projects and tasks are Orva's own records in Orva's own database, so a
 * project can point straight at the quotation it bills against and the two
 * percentages can be read together.
 */
export default function TasksPage() {
  const t = useT()
  const qc = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [projectId, setProjectId] = React.useState<string | null>(null)
  const [showDone, setShowDone] = React.useState(false)
  const [creatingProject, setCreatingProject] = React.useState(false)
  const [projectDraft, setProjectDraft] = React.useState({ name: '', quoteId: '' })
  const [title, setTitle] = React.useState('')
  const [dueOn, setDueOn] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [openTaskId, setOpenTaskId] = React.useState<string | null>(null)

  const projects = useQuery({
    queryKey: ['orva_tasking.projects', scopeVersion],
    queryFn: () => readApiResultOrThrow<{ items: Project[] }>('/api/orva_tasking/projects'),
  })
  const quotes = useQuery({
    queryKey: ['orva_documents.projects.pick', scopeVersion],
    queryFn: async () => (await readApiResultOrThrow<{ items: QuoteOption[] }>('/api/orva_documents/projects')).items,
    enabled: creatingProject,
  })

  const active = React.useMemo(() => {
    const list = (projects.data?.items ?? []).filter((p) => !p.isArchived)
    return list.find((p) => p.id === projectId) ?? list[0] ?? null
  }, [projects.data, projectId])

  const tasks = useQuery({
    queryKey: ['orva_tasking.tasks', active?.id, showDone, scopeVersion],
    queryFn: () => readApiResultOrThrow<{ items: Task[] }>(
      `/api/orva_tasking/tasks?projectId=${active!.id}&bucket=${showDone ? 'all' : 'open'}`,
    ),
    enabled: Boolean(active),
  })

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['orva_tasking.tasks'] })
    await qc.invalidateQueries({ queryKey: ['orva_tasking.projects'] })
  }

  const send = async (body: Record<string, unknown>, method: 'POST' | 'PUT', path: string, done?: string) => {
    setBusy(true)
    try {
      const res = await apiCall<{ ok: true }>(path, {
        method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok || !res.result) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'failed')
      if (done) flash(done, 'success')
      await refresh()
      return true
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err), 'error')
      return false
    } finally { setBusy(false) }
  }

  const addProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!projectDraft.name.trim()) return
    const ok = await send(
      { name: projectDraft.name, quoteId: projectDraft.quoteId || null },
      'POST', '/api/orva_tasking/projects',
      t('orva_tasking.projectCreated', 'สร้างโปรเจกต์แล้ว'),
    )
    if (ok) { setCreatingProject(false); setProjectDraft({ name: '', quoteId: '' }) }
  }

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!active || !title.trim()) return
    const ok = await send(
      { projectId: active.id, title, dueOn: dueOn || null },
      'POST', '/api/orva_tasking/tasks',
    )
    if (ok) { setTitle(''); setDueOn('') }
  }

  const toggle = (task: Task) =>
    send({ id: task.id, done: !task.done, updatedAt: task.updatedAt }, 'PUT', '/api/orva_tasking/tasks')

  const visibleProjects = (projects.data?.items ?? []).filter((p) => !p.isArchived)

  return (
    <Page>
      <PageHeader
        title={t('orva_tasking.page.title', 'งาน')}
        description={t('orva_tasking.page.description', 'งานของแต่ละโปรเจกต์ ผูกกับใบเสนอราคาที่เรียกเก็บ — งานที่ยังไม่เสร็จและใกล้ครบกำหนดขึ้นก่อน')}
        actions={<Button onClick={() => setCreatingProject((v) => !v)}>{t('orva_tasking.newProject', 'โปรเจกต์ใหม่')}</Button>}
      />
      <PageBody>
        {creatingProject ? (
          <form onSubmit={addProject} className="mb-4 flex flex-wrap items-end gap-2 rounded-md border p-4">
            <label className="flex flex-col gap-1 text-sm">
              <span>{t('orva_tasking.projectName', 'ชื่อโปรเจกต์')}</span>
              <Input className="w-64" value={projectDraft.name} onChange={(e) => setProjectDraft({ ...projectDraft, name: e.target.value })} required maxLength={200} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t('orva_tasking.linkedQuote', 'ใบเสนอราคาที่เรียกเก็บ')}</span>
              <select className="rounded-md border bg-background px-3 py-2" value={projectDraft.quoteId} onChange={(e) => setProjectDraft({ ...projectDraft, quoteId: e.target.value })}>
                <option value="">{t('orva_tasking.internalWork', '— งานภายใน ไม่ผูกใบเสนอราคา —')}</option>
                {(quotes.data ?? []).map((q) => (
                  <option key={q.quoteId} value={q.quoteId}>{q.quoteNumber}{q.customerName ? ` — ${q.customerName}` : ''}</option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={busy}>{t('orva_tasking.create', 'สร้าง')}</Button>
            <Button type="button" variant="outline" onClick={() => setCreatingProject(false)} disabled={busy}>{t('orva_tasking.cancel', 'ยกเลิก')}</Button>
          </form>
        ) : null}

        {projects.isLoading ? <p className="text-sm text-muted-foreground">…</p> : null}

        {visibleProjects.length > 0 ? (
          <div className="mb-4 flex flex-wrap gap-2">
            {visibleProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => setProjectId(project.id)}
                className={`rounded-full border px-3 py-1.5 text-sm ${active?.id === project.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
              >
                {project.name}
                <span className="ml-2 tabular-nums opacity-70">{project.done}/{project.total}</span>
                {project.overdue > 0 ? (
                  <span className="ml-1.5 rounded-full bg-status-error-bg px-1.5 text-xs text-status-error-text">{project.overdue}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}

        {active ? (
          <>
            <div className="mb-4 rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <span className="text-sm font-medium">{active.name}</span>
                  {active.quoteNumber ? (
                    <span className="ml-2 text-xs text-muted-foreground">{active.quoteNumber}</span>
                  ) : (
                    <span className="ml-2 text-xs text-muted-foreground">{t('orva_tasking.internalBadge', 'งานภายใน')}</span>
                  )}
                </div>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {t('orva_tasking.progress', 'เสร็จ {pct}% ({done}/{total})')
                    .replace('{pct}', String(active.donePct))
                    .replace('{done}', String(active.done))
                    .replace('{total}', String(active.total))}
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${active.donePct}%` }} />
              </div>
            </div>

            <form onSubmit={addTask} className="mb-4 flex flex-wrap items-end gap-2">
              <Input className="max-w-96" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('orva_tasking.newTask', 'เพิ่มงานใหม่…')} maxLength={250} />
              <Input type="date" className="w-44" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
              <Button type="submit" disabled={busy || !title.trim()}>{t('orva_tasking.add', 'เพิ่ม')}</Button>
              <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
                {t('orva_tasking.showDone', 'แสดงงานที่เสร็จแล้ว')}
              </label>
            </form>

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="w-10 px-3 py-2" />
                    <th className="px-3 py-2">{t('orva_tasking.col.task', 'งาน')}</th>
                    <th className="px-3 py-2">{t('orva_tasking.col.labels', 'ป้ายกำกับ')}</th>
                    <th className="px-3 py-2">{t('orva_tasking.col.due', 'กำหนดเสร็จ')}</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.isLoading ? <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">…</td></tr> : null}
                  {tasks.data?.items.length === 0 ? (
                    <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">{t('orva_tasking.empty', 'ยังไม่มีงานค้างในโปรเจกต์นี้')}</td></tr>
                  ) : null}
                  {(tasks.data?.items ?? []).map((task) => (
                    <tr key={task.id} className="border-b last:border-b-0">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={task.done}
                          disabled={busy}
                          onChange={() => toggle(task)}
                          aria-label={t('orva_tasking.toggle', 'ทำเครื่องหมายว่าเสร็จ')}
                        />
                      </td>
                      <td className="px-3 py-2">
                        {/* The title opens the detail; the checkbox stays a checkbox,
                            so ticking work off never costs a round trip through a form. */}
                        <button
                          type="button"
                          onClick={() => setOpenTaskId(task.id)}
                          className={`text-left hover:underline ${task.done ? 'text-muted-foreground line-through' : ''}`}
                        >
                          {task.title}
                        </button>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {task.percentDone > 0 && !task.done ? `${task.percentDone}%` : null}
                          {task.commentCount > 0 ? ` 💬${task.commentCount}` : null}
                          {task.relationCount > 0 ? ` ⛓${task.relationCount}` : null}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex flex-wrap gap-1">
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
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {task.dueOn ? (
                          <span className={task.daysOverdue > 0 ? 'text-status-error-text' : 'text-muted-foreground'}>
                            {task.dueOn}
                            {task.daysOverdue > 0 ? ` · ${t('orva_tasking.overdue', 'เลย {days} วัน').replace('{days}', String(task.daysOverdue))}` : ''}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : projects.data ? (
          <p className="text-sm text-muted-foreground">{t('orva_tasking.noProjects', 'ยังไม่มีโปรเจกต์ — สร้างโปรเจกต์แรกเพื่อเริ่มบันทึกงาน')}</p>
        ) : null}

        <TaskDrawer
          task={(tasks.data?.items ?? []).find((item) => item.id === openTaskId) ?? null}
          onClose={() => setOpenTaskId(null)}
          onSaved={refresh}
        />
      </PageBody>
    </Page>
  )
}
