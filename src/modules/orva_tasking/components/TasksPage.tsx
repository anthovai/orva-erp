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
import { BoardView } from './BoardView'
import { TimelineView } from './TimelineView'
import { TaskTableView, type TaskFilters } from './TaskTableView'
import type { BoardTask, TaskProjectSummary } from './taskTypes'

type QuoteOption = { quoteId: string; quoteNumber: string; customerName: string | null }

const VIEWS = ['table', 'board', 'timeline'] as const
type View = (typeof VIEWS)[number]

/**
 * งาน — work tracked beside the money it bills against.
 *
 * Projects and tasks are Orva's own records in Orva's own database, so a
 * project can point straight at the quotation it bills against and the two
 * percentages can be read together.
 *
 * Three views over one list of tasks: a table to read and filter, a board to
 * plan on, a timeline to see the shape of the month. The tasks are fetched
 * once and each view renders them, so switching view costs nothing.
 */
export default function TasksPage() {
  const t = useT()
  const qc = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [projectId, setProjectId] = React.useState<string | null>(null)
  const [view, setView] = React.useState<View>('table')
  const [filters, setFilters] = React.useState<TaskFilters>({ showDone: false })
  const [creatingProject, setCreatingProject] = React.useState(false)
  const [projectDraft, setProjectDraft] = React.useState({ name: '', quoteId: '' })
  const [busy, setBusy] = React.useState(false)
  const [openTaskId, setOpenTaskId] = React.useState<string | null>(null)
  const [publishing, setPublishing] = React.useState(false)

  const projects = useQuery({
    queryKey: ['orva_tasking.projects', scopeVersion],
    queryFn: () => readApiResultOrThrow<{ items: TaskProjectSummary[] }>('/api/orva_tasking/projects'),
  })
  const quotes = useQuery({
    queryKey: ['orva_documents.projects.pick', scopeVersion],
    queryFn: async () => (await readApiResultOrThrow<{ items: QuoteOption[] }>('/api/orva_documents/projects')).items,
    enabled: creatingProject,
  })
  const labels = useQuery({
    queryKey: ['orva_tasking.labels'],
    queryFn: async () =>
      (await readApiResultOrThrow<{ items: { id: string; title: string }[] }>('/api/orva_tasking/labels')).items,
  })
  const assignees = useQuery({
    queryKey: ['orva_tasking.assignees', scopeVersion],
    queryFn: async () =>
      (await readApiResultOrThrow<{ items: { id: string; name: string }[] }>('/api/orva_tasking/assignees')).items,
  })

  /**
   * Projects with unfinished, overdue work first, then the busiest.
   *
   * With one project the order is irrelevant; with eight — which is what the
   * KKG-Tasking import brought over — a flat alphabetical list buries the one
   * that needs attention.
   */
  const visibleProjects = React.useMemo(() => (
    (projects.data?.items ?? [])
      .filter((project) => !project.isArchived)
      .sort((a, b) => b.overdue - a.overdue || (b.total - b.done) - (a.total - a.done) || a.name.localeCompare(b.name, 'th'))
  ), [projects.data])

  // Derived from the sorted list, so opening the page lands on the same
  // project the picker puts at the top. Reading them from two differently
  // ordered lists showed the picker sorted by lateness while selecting
  // whichever project the API happened to return first.
  const active = React.useMemo(
    () => visibleProjects.find((project) => project.id === projectId) ?? visibleProjects[0] ?? null,
    [visibleProjects, projectId],
  )

  // The board and the timeline always need the whole project — a board that
  // hides finished cards has no Done column worth looking at.
  const wantsAll = view !== 'table' || filters.showDone

  const taskQueryKey = [
    'orva_tasking.tasks', active?.id, wantsAll,
    view === 'table' ? filters.assigneeUserId ?? '' : '',
    view === 'table' ? filters.labelId ?? '' : '',
    view === 'table' ? filters.dueWithinDays ?? '' : '',
    scopeVersion,
  ]

  const tasks = useQuery({
    queryKey: taskQueryKey,
    queryFn: () => {
      const params = new URLSearchParams({ projectId: active!.id, bucket: wantsAll ? 'all' : 'open' })
      if (view === 'table') {
        if (filters.assigneeUserId) params.set('assigneeUserId', filters.assigneeUserId)
        if (filters.labelId) params.set('labelId', filters.labelId)
        if (filters.dueWithinDays !== undefined) params.set('dueWithinDays', String(filters.dueWithinDays))
      }
      return readApiResultOrThrow<{ items: BoardTask[] }>(`/api/orva_tasking/tasks?${params.toString()}`)
    },
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

  const addProject = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!projectDraft.name.trim()) return
    const ok = await send(
      { name: projectDraft.name, quoteId: projectDraft.quoteId || null },
      'POST', '/api/orva_tasking/projects',
      t('orva_tasking.projectCreated', 'สร้างโปรเจกต์แล้ว'),
    )
    if (ok) { setCreatingProject(false); setProjectDraft({ name: '', quoteId: '' }) }
  }

  const quickAdd = async (title: string, dueOn: string) => {
    if (!active) return
    await send({ projectId: active.id, title, dueOn: dueOn || null }, 'POST', '/api/orva_tasking/tasks')
  }

  /**
   * Show the project to its customer, or stop showing it.
   *
   * Turning it on says out loud how many tasks become readable and that
   * comments and files stay internal, because the owner is about to change
   * what someone outside the company can see.
   */
  const togglePublish = async () => {
    if (!active) return
    if (!active.quoteId) return
    if (!active.customerVisible) {
      const ok = window.confirm(
        t('orva_tasking.confirmPublish', 'เปิดให้ลูกค้าดู "{name}" ไหม งาน {n} รายการจะมองเห็นได้ ส่วนคอมเมนต์และไฟล์ยังเป็นความลับจนกดเปิดทีละอัน')
          .replace('{name}', active.name)
          .replace('{n}', String(active.total)),
      )
      if (!ok) return
    }
    setPublishing(true)
    try {
      const res = await apiCall<{ ok: true; visibleTasks?: number }>('/api/orva_tasking/projects/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: active.id, visible: !active.customerVisible, updatedAt: active.updatedAt }),
      })
      if (!res.ok || !res.result) {
        throw new Error((res.result as { error?: string } | undefined)?.error ?? t('orva_tasking.saveFailed', 'บันทึกไม่สำเร็จ'))
      }
      flash(
        active.customerVisible
          ? t('orva_tasking.unpublished', 'ปิดการแสดงต่อลูกค้าแล้ว')
          : t('orva_tasking.published', 'เปิดให้ลูกค้าดูแล้ว'),
        'success',
      )
      await refresh()
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err), 'error')
    } finally { setPublishing(false) }
  }

  const toggleDone = (task: BoardTask) =>
    send({ id: task.id, done: !task.done, updatedAt: task.updatedAt }, 'PUT', '/api/orva_tasking/tasks')

  const viewLabel: Record<View, string> = {
    table: t('orva_tasking.view.table', 'ตาราง'),
    board: t('orva_tasking.view.board', 'บอร์ด'),
    timeline: t('orva_tasking.view.timeline', 'ไทม์ไลน์'),
  }

  return (
    <Page>
      <PageHeader
        title={t('orva_tasking.page.title', 'งาน')}
        description={t('orva_tasking.page.description', 'งานของแต่ละโปรเจกต์ ผูกกับใบเสนอราคาที่เรียกเก็บ — งานที่ยังไม่เสร็จและใกล้ครบกำหนดขึ้นก่อน')}
        actions={<Button onClick={() => setCreatingProject((open) => !open)}>{t('orva_tasking.newProject', 'โปรเจกต์ใหม่')}</Button>}
      />
      <PageBody>
        {creatingProject ? (
          <form onSubmit={addProject} className="mb-4 flex flex-wrap items-end gap-2 rounded-md border p-4">
            <label className="flex flex-col gap-1 text-sm">
              <span>{t('orva_tasking.projectName', 'ชื่อโปรเจกต์')}</span>
              <Input className="w-64" value={projectDraft.name} onChange={(event) => setProjectDraft({ ...projectDraft, name: event.target.value })} required maxLength={200} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t('orva_tasking.linkedQuote', 'ใบเสนอราคาที่เรียกเก็บ')}</span>
              <select className="rounded-md border bg-background px-3 py-2" value={projectDraft.quoteId} onChange={(event) => setProjectDraft({ ...projectDraft, quoteId: event.target.value })}>
                <option value="">{t('orva_tasking.internalWork', '— งานภายใน ไม่ผูกใบเสนอราคา —')}</option>
                {(quotes.data ?? []).map((quote) => (
                  <option key={quote.quoteId} value={quote.quoteId}>{quote.quoteNumber}{quote.customerName ? ` — ${quote.customerName}` : ''}</option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={busy}>{t('orva_tasking.create', 'สร้าง')}</Button>
            <Button type="button" variant="outline" onClick={() => setCreatingProject(false)} disabled={busy}>{t('orva_tasking.cancel', 'ยกเลิก')}</Button>
          </form>
        ) : null}

        {projects.isLoading ? <p className="text-sm text-muted-foreground">…</p> : null}

        {/*
          A picker rather than a wall of chips. Chips read well up to about
          five projects and then wrap into rows that have to be scanned; a
          select stays one line however many projects there are, and typing
          jumps to one by name. The counts stay in the option text so the
          picker still answers "which one is behind" without opening it.
        */}
        {visibleProjects.length > 0 ? (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <label className="text-sm text-muted-foreground" htmlFor="project-picker">
              {t('orva_tasking.pickProject', 'โปรเจกต์')}
            </label>
            <select
              id="project-picker"
              className="min-w-72 max-w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={active?.id ?? ''}
              onChange={(event) => setProjectId(event.target.value)}
            >
              {visibleProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} · {project.done}/{project.total}
                  {project.overdue > 0
                    ? ' · ' + t('orva_tasking.overdueShort', 'เลยกำหนด {n}').replace('{n}', String(project.overdue))
                    : ''}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">
              {t('orva_tasking.projectCount', '{n} โปรเจกต์').replace('{n}', String(visibleProjects.length))}
            </span>
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

              {/* Only speaks up when there is something to do: a published
                  project says so, an unlinked one explains why it cannot be. */}
              {active.quoteId || active.customerVisible ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                  <Button
                    type="button"
                    size="sm"
                    variant={active.customerVisible ? 'outline' : 'default'}
                    onClick={togglePublish}
                    disabled={publishing}
                  >
                    {active.customerVisible
                      ? t('orva_tasking.unpublish', 'ปิดไม่ให้ลูกค้าดู')
                      : t('orva_tasking.publish', 'ให้ลูกค้าดูได้')}
                  </Button>
                  {active.customerVisible ? (
                    <span className="rounded-full bg-status-success-bg px-2 py-0.5 text-xs text-status-success-text">
                      {t('orva_tasking.publishedBadge', 'ลูกค้าดูได้')}
                    </span>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                  {t('orva_tasking.publishNeedsQuote', 'ต้องผูกใบเสนอราคาก่อน จึงจะรู้ว่าลูกค้ารายไหนควรเห็น')}
                </p>
              )}
            </div>

            {/* One joined control, so the selected view is obvious at a glance
                rather than three loose buttons with a faint highlight. */}
            <div
              className="mb-4 inline-flex overflow-hidden rounded-md border"
              role="tablist"
              aria-label={t('orva_tasking.viewSwitcher', 'มุมมอง')}
            >
              {VIEWS.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  role="tab"
                  aria-selected={view === candidate}
                  onClick={() => setView(candidate)}
                  className={`border-r px-4 py-1.5 text-sm last:border-r-0 ${
                    view === candidate
                      ? 'bg-primary font-medium text-primary-foreground'
                      : 'hover:bg-muted'
                  }`}
                >
                  {viewLabel[candidate]}
                </button>
              ))}
            </div>

            {view === 'table' ? (
              <TaskTableView
                tasks={tasks.data?.items ?? []}
                isLoading={tasks.isLoading}
                error={tasks.error ? t('orva_tasking.loadFailed', 'โหลดงานไม่สำเร็จ') : null}
                labels={labels.data ?? []}
                assignees={assignees.data ?? []}
                filters={filters}
                onFiltersChange={setFilters}
                onOpenTask={setOpenTaskId}
                onToggleDone={toggleDone}
                onQuickAdd={quickAdd}
                busy={busy}
                canAdd
              />
            ) : null}

            {view === 'board' ? (
              <BoardView
                projectId={active.id}
                tasks={tasks.data?.items ?? []}
                onOpenTask={setOpenTaskId}
                onChanged={refresh}
              />
            ) : null}

            {view === 'timeline' ? (
              <TimelineView
                tasks={tasks.data?.items ?? []}
                onOpenTask={setOpenTaskId}
                onChanged={refresh}
              />
            ) : null}
          </>
        ) : projects.data ? (
          <p className="text-sm text-muted-foreground">{t('orva_tasking.noProjects', 'ยังไม่มีโปรเจกต์ — สร้างโปรเจกต์แรกเพื่อเริ่มบันทึกงาน')}</p>
        ) : null}

        <TaskDrawer
          task={(tasks.data?.items ?? []).find((item) => item.id === openTaskId) ?? null}
          assignees={assignees.data ?? []}
          onClose={() => setOpenTaskId(null)}
          onSaved={refresh}
        />
      </PageBody>
    </Page>
  )
}
