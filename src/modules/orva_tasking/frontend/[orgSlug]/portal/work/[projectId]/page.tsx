"use client"
import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PortalCard, PortalCardHeader, PortalStatRow } from '@open-mercato/ui/portal/components/PortalCard'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { PortalEmptyState } from '@open-mercato/ui/portal/components/PortalEmptyState'
import { Button } from '@open-mercato/ui/primitives/button'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type PortalTask = {
  id: string; title: string; done: boolean; doneAt: string | null
  dueOn: string | null; startDate: string | null; endDate: string | null
  percentDone: number; daysOverdue: number
  labels: { title: string; hexColor: string }[]
}

type PortalComment = { id: string; taskId: string; body: string; fromCustomer: boolean; createdAt: string }

type PortalProjectDetail = {
  project: { id: string; name: string; description: string | null }
  quote: { number: string; total: string; currency: string }
  installments: { number: string; dueDate: string | null; total: string; status: string }[]
  tasks: PortalTask[]
  comments: PortalComment[]
  files: { id: string; taskId: string }[]
}

/**
 * One project, as its customer sees it.
 *
 * The work and the money on the same page, which is the whole reason this is a
 * portal page and not the anonymous link it replaces: a token cannot be tied
 * to a customer, so it can never show that customer their own quotation.
 *
 * A project that is not theirs answers 404 from the API, and this page shows
 * the same "not found" for a missing project as for someone else's.
 */
export default function PortalProjectPage({
  params,
}: {
  params: { orgSlug: string; projectId: string }
}) {
  const t = useT()
  const qc = useQueryClient()
  const { orgSlug, projectId } = params
  const [replyTo, setReplyTo] = React.useState<string | null>(null)
  const [body, setBody] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const detail = useQuery({
    queryKey: ['orva_tasking.portal.project', projectId],
    queryFn: () => readApiResultOrThrow<PortalProjectDetail>(`/api/orva_tasking/portal/projects/${projectId}`),
    retry: false,
  })

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!replyTo || !body.trim()) return
    setBusy(true)
    try {
      const res = await apiCall<{ ok: true }>('/api/orva_tasking/portal/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId: replyTo, body }),
      })
      if (!res.ok || !res.result) {
        throw new Error((res.result as { error?: string } | undefined)?.error ?? t('orva_tasking.portal.sendFailed', 'ส่งไม่สำเร็จ'))
      }
      setBody('')
      setReplyTo(null)
      flash(t('orva_tasking.portal.sent', 'ส่งข้อความแล้ว'), 'success')
      await qc.invalidateQueries({ queryKey: ['orva_tasking.portal.project', projectId] })
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err), 'error')
    } finally { setBusy(false) }
  }

  if (detail.isLoading) {
    return <PortalCard><p className="text-sm text-muted-foreground">{t('orva_tasking.portal.loading', 'กำลังโหลด…')}</p></PortalCard>
  }

  if (detail.error || !detail.data) {
    return (
      <PortalCard>
        <PortalEmptyState
          title={t('orva_tasking.portal.notFound', 'ไม่พบงานนี้')}
          description={t('orva_tasking.portal.notFoundHint', 'อาจถูกปิดการแสดงไปแล้ว — ติดต่อผู้ดูแลโครงการได้เลย')}
          action={
            <Button asChild variant="outline">
              <Link href={`/${orgSlug}/portal/work`}>{t('orva_tasking.portal.back', 'กลับไปรายการงาน')}</Link>
            </Button>
          }
        />
      </PortalCard>
    )
  }

  const { project, quote, installments, tasks, comments, files } = detail.data
  const done = tasks.filter((task) => task.done).length
  const percent = tasks.length ? Math.round((done / tasks.length) * 100) : 0
  const commentsFor = (taskId: string) => comments.filter((comment) => comment.taskId === taskId)
  const filesFor = (taskId: string) => files.filter((file) => file.taskId === taskId)

  return (
    <div className="space-y-6">
      <PortalPageHeader
        title={project.name}
        description={project.description ?? undefined}
      />

      <Button asChild variant="ghost" size="sm">
        <Link href={`/${orgSlug}/portal/work`}>{t('orva_tasking.portal.back', 'กลับไปรายการงาน')}</Link>
      </Button>

      <div className="grid gap-6 lg:grid-cols-3">
        <PortalCard className="lg:col-span-2">
          <PortalCardHeader
            title={t('orva_tasking.portal.tasks', 'รายการงาน')}
            description={t('orva_tasking.portal.progressSummary', 'เสร็จ {done} จาก {total} · {pct}%')
              .replace('{done}', String(done))
              .replace('{total}', String(tasks.length))
              .replace('{pct}', String(percent))}
          />

          {tasks.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {t('orva_tasking.portal.noTasks', 'ยังไม่มีรายการงานที่เปิดให้ดู')}
            </p>
          ) : null}

          <ul className="mt-3 divide-y">
            {tasks.map((task) => (
              <li key={task.id} className="py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className={`text-sm ${task.done ? 'text-muted-foreground line-through' : 'font-medium'}`}>
                    {task.title}
                  </span>
                  {task.done ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                      {t('orva_tasking.portal.doneBadge', 'เสร็จแล้ว')}
                    </span>
                  ) : task.daysOverdue > 0 ? (
                    <span className="rounded-full bg-status-error-bg px-2 py-0.5 text-xs text-status-error-text">
                      {t('orva_tasking.overdue', 'เลย {days} วัน').replace('{days}', String(task.daysOverdue))}
                    </span>
                  ) : task.dueOn ? (
                    <span className="tabular-nums text-xs text-muted-foreground">{task.dueOn}</span>
                  ) : null}
                  {task.percentDone > 0 && !task.done ? (
                    <span className="tabular-nums text-xs text-muted-foreground">{task.percentDone}%</span>
                  ) : null}
                  {task.labels.map((label) => (
                    <span key={label.title} className="rounded-full border px-2 py-0.5 text-xs">
                      <span
                        aria-hidden="true"
                        className="mr-1 inline-block size-2 rounded-full align-middle"
                        style={{ backgroundColor: label.hexColor }}
                      />
                      {label.title}
                    </span>
                  ))}
                </div>

                {filesFor(task.id).length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {filesFor(task.id).map((file) => (
                      <li key={file.id}>
                        <a
                          className="text-xs underline"
                          href={`/api/attachments/file/${file.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t('orva_tasking.portal.openFile', 'เปิดไฟล์')}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {commentsFor(task.id).length > 0 ? (
                  <ul className="mt-2 space-y-2">
                    {commentsFor(task.id).map((comment) => (
                      <li key={comment.id} className="rounded-md border p-2 text-sm">
                        <p className="mb-1 text-xs text-muted-foreground">
                          {comment.fromCustomer
                            ? t('orva_tasking.portal.fromYou', 'คุณ')
                            : t('orva_tasking.portal.fromTeam', 'ทีมงาน')}
                          {' · '}
                          {comment.createdAt.slice(0, 16).replace('T', ' ')}
                        </p>
                        <p className="whitespace-pre-wrap">{comment.body}</p>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {replyTo === task.id ? (
                  <form onSubmit={submit} className="mt-2 space-y-2">
                    <Textarea
                      autoFocus
                      rows={3}
                      maxLength={4000}
                      value={body}
                      onChange={(event) => setBody(event.target.value)}
                      aria-label={t('orva_tasking.portal.yourMessage', 'ข้อความของคุณ')}
                      placeholder={t('orva_tasking.portal.yourMessage', 'ข้อความของคุณ')}
                    />
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" disabled={busy || !body.trim()}>
                        {t('orva_tasking.portal.send', 'ส่ง')}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => { setReplyTo(null); setBody('') }} disabled={busy}>
                        {t('orva_tasking.cancel', 'ยกเลิก')}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-1"
                    onClick={() => { setReplyTo(task.id); setBody('') }}
                  >
                    {t('orva_tasking.portal.reply', 'ส่งข้อความเรื่องนี้')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </PortalCard>

        <PortalCard>
          <PortalCardHeader
            title={t('orva_tasking.portal.billing', 'ใบเสนอราคาและงวด')}
            label={quote.number}
          />
          <div className="mt-2 divide-y">
            <PortalStatRow
              label={t('orva_tasking.portal.quoteTotal', 'มูลค่ารวม')}
              value={<span className="tabular-nums">{quote.total} {quote.currency}</span>}
            />
            {installments.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">
                {t('orva_tasking.portal.noInstallments', 'ยังไม่มีการวางบิลงวดใด')}
              </p>
            ) : null}
            {installments.map((installment) => (
              <PortalStatRow
                key={installment.number}
                label={installment.dueDate
                  ? `${installment.number} · ${installment.dueDate}`
                  : installment.number}
                value={
                  <span className="tabular-nums">
                    {installment.total}
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
                      {t(`orva_tasking.portal.invoiceStatus.${installment.status}`, installment.status)}
                    </span>
                  </span>
                }
              />
            ))}
          </div>
        </PortalCard>
      </div>
    </div>
  )
}
