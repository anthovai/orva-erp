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

type Project = { id: number; title: string; description: string | null; total: number; done: number; donePct: number }
type Task = { id: number; identifier: string | null; title: string; description: string | null; done: boolean; dueDate: string | null; priority: number; percentDone: number }

/**
 * งาน — tasks as a native Orva screen.
 *
 * The data and the task rules live in KKG-Tasking (the company's Vikunja
 * fork), which runs as the `tasking` service in this stack; this module owns
 * the screens so tasks read as part of Orva rather than as a second product.
 * Everything goes through Orva's own API routes, so the Tasking token stays on
 * the server and never reaches the browser.
 */
export default function TasksPage() {
  const t = useT()
  const qc = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [projectId, setProjectId] = React.useState<number | null>(null)
  const [title, setTitle] = React.useState('')
  const [dueDate, setDueDate] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const projects = useQuery({
    queryKey: ['orva_tasking.projects', scopeVersion],
    queryFn: () => readApiResultOrThrow<{ configured: boolean; items: Project[] }>('/api/orva_tasking/projects'),
  })

  const activeProject = React.useMemo(() => {
    const list = projects.data?.items ?? []
    return list.find((p) => p.id === projectId) ?? list[0] ?? null
  }, [projects.data, projectId])

  const tasks = useQuery({
    queryKey: ['orva_tasking.tasks', activeProject?.id, scopeVersion],
    queryFn: () => readApiResultOrThrow<{ items: Task[] }>(`/api/orva_tasking/tasks?projectId=${activeProject!.id}`),
    enabled: Boolean(activeProject),
  })

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['orva_tasking.tasks'] })
    await qc.invalidateQueries({ queryKey: ['orva_tasking.projects'] })
  }

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeProject || !title.trim()) return
    setBusy(true)
    try {
      const res = await apiCall<{ ok: true }>('/api/orva_tasking/tasks', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: activeProject.id, title, dueDate: dueDate || null }),
      })
      if (!res.ok) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'failed')
      setTitle(''); setDueDate('')
      await refresh()
    } catch (err) { flash(err instanceof Error ? err.message : String(err), 'error') } finally { setBusy(false) }
  }

  const toggle = async (task: Task) => {
    setBusy(true)
    try {
      const res = await apiCall<{ ok: true }>('/api/orva_tasking/tasks', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId: task.id, done: !task.done }),
      })
      if (!res.ok) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'failed')
      await refresh()
    } catch (err) { flash(err instanceof Error ? err.message : String(err), 'error') } finally { setBusy(false) }
  }

  // Shipped before the token exists, so this is a setup instruction rather
  // than an error state.
  if (projects.data && !projects.data.configured) {
    return (
      <Page>
        <PageHeader title={t('orva_tasking.page.title', 'งาน')} />
        <PageBody>
          <div className="rounded-md border bg-card p-6 text-sm">
            <p className="font-medium">{t('orva_tasking.setup.title', 'ยังไม่ได้เชื่อมระบบงาน')}</p>
            <p className="mt-2 text-muted-foreground">
              {t('orva_tasking.setup.body', 'สร้าง API token ใน KKG-Tasking แล้วใส่ TASKING_TOKEN ใน .env จากนั้นรีสตาร์ทเซิร์ฟเวอร์')}
            </p>
          </div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader
        title={t('orva_tasking.page.title', 'งาน')}
        description={t('orva_tasking.page.description', 'งานของแต่ละโปรเจกต์ — งานที่ยังไม่เสร็จและใกล้ครบกำหนดขึ้นก่อน')}
      />
      <PageBody>
        {projects.isLoading ? <p className="text-sm text-muted-foreground">…</p> : null}

        {(projects.data?.items ?? []).length > 0 ? (
          <div className="mb-4 flex flex-wrap gap-2">
            {(projects.data?.items ?? []).map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => setProjectId(project.id)}
                className={`rounded-full border px-3 py-1.5 text-sm ${activeProject?.id === project.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
              >
                {project.title}
                <span className="ml-2 tabular-nums opacity-70">{project.done}/{project.total}</span>
              </button>
            ))}
          </div>
        ) : null}

        {activeProject ? (
          <>
            <div className="mb-4 rounded-lg border bg-card p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{activeProject.title}</span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {t('orva_tasking.progress', 'เสร็จ {pct}% ({done}/{total})')
                    .replace('{pct}', String(activeProject.donePct))
                    .replace('{done}', String(activeProject.done))
                    .replace('{total}', String(activeProject.total))}
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${activeProject.donePct}%` }} />
              </div>
            </div>

            <form onSubmit={addTask} className="mb-4 flex flex-wrap items-end gap-2">
              <Input
                className="max-w-96"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('orva_tasking.newTask', 'เพิ่มงานใหม่…')}
                maxLength={250}
              />
              <Input type="date" className="w-44" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              <Button type="submit" disabled={busy || !title.trim()}>{t('orva_tasking.add', 'เพิ่ม')}</Button>
            </form>

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="w-10 px-3 py-2" />
                    <th className="px-3 py-2">{t('orva_tasking.col.task', 'งาน')}</th>
                    <th className="px-3 py-2">{t('orva_tasking.col.due', 'กำหนดเสร็จ')}</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.isLoading ? <tr><td colSpan={3} className="px-3 py-8 text-center text-muted-foreground">…</td></tr> : null}
                  {tasks.data?.items.length === 0 ? (
                    <tr><td colSpan={3} className="px-3 py-8 text-center text-muted-foreground">{t('orva_tasking.empty', 'ยังไม่มีงานในโปรเจกต์นี้')}</td></tr>
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
                      <td className={`px-3 py-2 ${task.done ? 'text-muted-foreground line-through' : ''}`}>
                        {task.title}
                        {task.identifier ? <span className="ml-2 text-xs text-muted-foreground">{task.identifier}</span> : null}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{task.dueDate ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : projects.data ? (
          <p className="text-sm text-muted-foreground">{t('orva_tasking.noProjects', 'ยังไม่มีโปรเจกต์ในระบบงาน')}</p>
        ) : null}
      </PageBody>
    </Page>
  )
}
