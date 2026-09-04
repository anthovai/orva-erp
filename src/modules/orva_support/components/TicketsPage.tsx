"use client"
import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Ticket = {
  id: string; ticketNo: string; subject: string; description?: string | null; kind: string; priority: string; status: string
  customerEntityId: string | null; customerName: string | null; contactEmail: string | null; quoteId?: string | null
  dueOn: string | null; minutesSpent: number; ageHours: number; responseHours: number | null
  awaitingFirstResponse: boolean; daysOverdue: number; createdAt: string; updatedAt: string
}
type TicketsResponse = { items: Ticket[]; total: number; counts: { open: number; waiting: number; overdue: number; unanswered: number; minutesOpen: number } }
type Reply = { id: string; author: string; body: string; minutesSpent: number; createdAt: string }
type Company = { id: string; entity_id?: string | null; display_name?: string | null; legal_name?: string | null }
type Project = { quoteId: string; quoteNumber: string; customerName: string | null }

const KINDS = ['bug', 'question', 'change_request', 'incident'] as const
const PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const
const STATUSES = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'] as const

const hours = (m: number) => (m / 60).toLocaleString('th-TH', { maximumFractionDigits: 2 })

/**
 * ซัพพอร์ตลูกค้า — the queue for bugs and requests on software we shipped:
 * urgent and overdue on top, one click to reply, log the minutes and move the
 * status. Not internal IT admin (that stays in the settings panel).
 */
export default function TicketsPage() {
  const t = useT()
  const qc = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const searchParams = useSearchParams()
  const [bucket, setBucket] = React.useState<'open' | 'all'>('open')
  const [search, setSearch] = React.useState('')
  const [quoteFilter, setQuoteFilter] = React.useState<string>(() => searchParams.get('quoteId') ?? '')
  const [selected, setSelected] = React.useState<Ticket | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [draft, setDraft] = React.useState({ subject: '', description: '', kind: 'bug', priority: 'normal', customerEntityId: '', contactEmail: '', dueOn: '', quoteId: '' })
  const [reply, setReply] = React.useState({ body: '', minutes: 0, author: 'staff' as 'staff' | 'customer' | 'note', status: '' })
  const [busy, setBusy] = React.useState(false)

  const list = useQuery({
    queryKey: ['orva_support.tickets', bucket, search, quoteFilter, scopeVersion],
    queryFn: () => {
      const qs = new URLSearchParams({ bucket })
      if (search) qs.set('search', search)
      if (quoteFilter) qs.set('quoteId', quoteFilter)
      return readApiResultOrThrow<TicketsResponse>(`/api/orva_support/tickets?${qs}`)
    },
  })
  const replies = useQuery({
    queryKey: ['orva_support.replies', selected?.id],
    queryFn: () => readApiResultOrThrow<{ items: Reply[] }>(`/api/orva_support/replies?id=${selected!.id}`),
    enabled: Boolean(selected),
  })
  const companies = useQuery({
    queryKey: ['customers.companies.pick', scopeVersion],
    queryFn: async () => (await readApiResultOrThrow<{ items: Company[] }>('/api/customers/companies?pageSize=100')).items,
    enabled: creating,
  })
  const projects = useQuery({
    queryKey: ['orva_documents.projects.pick', scopeVersion],
    queryFn: async () => (await readApiResultOrThrow<{ items: Project[] }>('/api/orva_documents/projects')).items,
    enabled: creating,
  })

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['orva_support.tickets'] })
    if (selected) await qc.invalidateQueries({ queryKey: ['orva_support.replies'] })
  }

  const create = async () => {
    if (!draft.subject.trim()) { flash(t('orva_support.needSubject', 'ใส่หัวเรื่องก่อน'), 'error'); return }
    setBusy(true)
    try {
      const res = await apiCall<{ ok: true; ticketNo: string }>('/api/orva_support/tickets', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...draft, customerEntityId: draft.customerEntityId || null, contactEmail: draft.contactEmail || null, dueOn: draft.dueOn || null, description: draft.description || null, quoteId: draft.quoteId || null }),
      })
      if (!res.ok || !res.result) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'failed')
      flash(t('orva_support.created', 'เปิดเรื่อง {no} แล้ว').replace('{no}', res.result.ticketNo), 'success')
      setCreating(false)
      setDraft({ subject: '', description: '', kind: 'bug', priority: 'normal', customerEntityId: '', contactEmail: '', dueOn: '', quoteId: '' })
      await refresh()
    } catch (e) { flash(e instanceof Error ? e.message : String(e), 'error') } finally { setBusy(false) }
  }

  const send = async () => {
    if (!selected || !reply.body.trim()) return
    setBusy(true)
    try {
      const res = await apiCall<{ ok: true; status: string; minutesSpent: number; updatedAt: string }>('/api/orva_support/replies', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticketId: selected.id, author: reply.author, body: reply.body, minutesSpent: reply.minutes, ...(reply.status ? { status: reply.status } : {}) }),
      })
      if (!res.ok || !res.result) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'failed')
      setSelected({ ...selected, status: res.result.status, minutesSpent: res.result.minutesSpent, updatedAt: res.result.updatedAt })
      setReply({ body: '', minutes: 0, author: 'staff', status: '' })
      await refresh()
    } catch (e) { flash(e instanceof Error ? e.message : String(e), 'error') } finally { setBusy(false) }
  }

  const move = async (status: string) => {
    if (!selected) return
    setBusy(true)
    try {
      const res = await apiCall<{ ok: true; status: string; updatedAt: string }>('/api/orva_support/tickets', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: selected.id, status, updatedAt: selected.updatedAt }),
      })
      if (!res.ok || !res.result) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'failed')
      setSelected({ ...selected, status: res.result.status, updatedAt: res.result.updatedAt })
      await refresh()
    } catch (e) { flash(e instanceof Error ? e.message : String(e), 'error') } finally { setBusy(false) }
  }

  const label = (group: string, value: string) => t(`orva_support.${group}.${value}`, value)
  const priorityTone = (p: string) => (p === 'urgent' ? 'text-status-error-text' : p === 'high' ? 'text-status-warning-text' : '')

  return (
    <Page>
      <PageHeader
        title={t('orva_support.page.title', 'ซัพพอร์ตลูกค้า')}
        description={t('orva_support.page.description', 'บั๊กและคำขอจากลูกค้าที่ใช้ซอฟต์แวร์ของเรา — เรื่องด่วนและเลยกำหนดขึ้นก่อน ตอบกลับ บันทึกเวลา และเปลี่ยนสถานะได้ในที่เดียว')}
        actions={<Button onClick={() => setCreating((v) => !v)}>{t('orva_support.new', 'เปิดเรื่องใหม่')}</Button>}
      />
      <PageBody>
        {list.data ? (
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <Kpi label={t('orva_support.kpi.open', 'เรื่องที่ยังไม่ปิด')} value={String(list.data.counts.open)} />
            <Kpi label={t('orva_support.kpi.unanswered', 'ยังไม่ได้ตอบ')} value={String(list.data.counts.unanswered)} tone={list.data.counts.unanswered > 0 ? 'bad' : undefined} />
            <Kpi label={t('orva_support.kpi.overdue', 'เลยกำหนด')} value={String(list.data.counts.overdue)} tone={list.data.counts.overdue > 0 ? 'warn' : undefined} />
            <Kpi label={t('orva_support.kpi.hours', 'เวลาที่ใช้ไป (ชม.)')} value={hours(list.data.counts.minutesOpen)} />
          </div>
        ) : null}

        {creating ? (
          <form className="mb-4 grid gap-3 rounded-md border p-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void create() }}>
            <label className="flex flex-col gap-1 text-sm md:col-span-2">
              <span>{t('orva_support.field.subject', 'หัวเรื่อง')}</span>
              <Input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} required maxLength={300} />
            </label>
            <label className="flex flex-col gap-1 text-sm md:col-span-2">
              <span>{t('orva_support.field.description', 'รายละเอียด / ขั้นตอนที่ทำให้เกิดปัญหา')}</span>
              <textarea className="rounded-md border bg-background px-3 py-2" rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t('orva_support.field.customer', 'ลูกค้า')}</span>
              <select className="rounded-md border bg-background px-3 py-2" value={draft.customerEntityId} onChange={(e) => setDraft({ ...draft, customerEntityId: e.target.value })}>
                <option value="">—</option>
                {(companies.data ?? []).map((c) => <option key={c.id} value={String(c.entity_id ?? c.id)}>{c.legal_name ?? c.display_name ?? c.id}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t('orva_support.field.contactEmail', 'อีเมลผู้แจ้ง')}</span>
              <Input type="email" value={draft.contactEmail} onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t('orva_support.field.kind', 'ประเภท')}</span>
              <select className="rounded-md border bg-background px-3 py-2" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                {KINDS.map((k) => <option key={k} value={k}>{label('kind', k)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t('orva_support.field.priority', 'ความสำคัญ')}</span>
              <select className="rounded-md border bg-background px-3 py-2" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{label('priority', p)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t('orva_support.field.project', 'โปรเจกต์ที่เกี่ยวข้อง')}</span>
              <select className="rounded-md border bg-background px-3 py-2" value={draft.quoteId} onChange={(e) => setDraft({ ...draft, quoteId: e.target.value })}>
                <option value="">—</option>
                {(projects.data ?? []).map((p) => (
                  <option key={p.quoteId} value={p.quoteId}>{p.quoteNumber}{p.customerName ? ` — ${p.customerName}` : ''}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t('orva_support.field.dueOn', 'กำหนดเสร็จ')}</span>
              <Input type="date" value={draft.dueOn} onChange={(e) => setDraft({ ...draft, dueOn: e.target.value })} />
            </label>
            <div className="flex items-end gap-2">
              <Button type="submit" disabled={busy}>{t('orva_support.create', 'เปิดเรื่อง')}</Button>
              <Button type="button" variant="outline" onClick={() => setCreating(false)} disabled={busy}>{t('orva_support.cancel', 'ยกเลิก')}</Button>
            </div>
          </form>
        ) : null}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select className="rounded-md border bg-background px-3 py-2 text-sm" value={bucket} onChange={(e) => setBucket(e.target.value as 'open' | 'all')}>
            <option value="open">{t('orva_support.filter.open', 'ที่ยังไม่ปิด')}</option>
            <option value="all">{t('orva_support.filter.all', 'ทั้งหมด')}</option>
          </select>
          <Input className="max-w-64" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('orva_support.search', 'ค้นหาเลขที่ / หัวเรื่อง / ลูกค้า')} />
          {quoteFilter ? (
            <div className="flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-300">
              <span>{t('orva_support.filter.project', 'กรองเฉพาะโปรเจกต์')}</span>
              <button type="button" className="ml-1 hover:opacity-70" onClick={() => setQuoteFilter('')}>×</button>
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 lg:grid-cols-5">
          <section className="lg:col-span-3">
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="px-3 py-2">{t('orva_support.col.ticket', 'เรื่อง')}</th>
                    <th className="px-3 py-2">{t('orva_support.col.customer', 'ลูกค้า')}</th>
                    <th className="px-3 py-2">{t('orva_support.col.status', 'สถานะ')}</th>
                    <th className="px-3 py-2 text-right">{t('orva_support.col.age', 'อายุ (ชม.)')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.isLoading ? <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">…</td></tr> : null}
                  {list.data?.items.length === 0 ? <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">{t('orva_support.empty', 'ไม่มีเรื่องค้าง')}</td></tr> : null}
                  {(list.data?.items ?? []).map((row) => (
                    <tr key={row.id} className={`cursor-pointer border-b last:border-b-0 hover:bg-muted/40 ${selected?.id === row.id ? 'bg-muted/60' : ''}`} onClick={() => setSelected(row)}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{row.ticketNo}</span>
                          <span className={`text-xs ${priorityTone(row.priority)}`}>{label('priority', row.priority)}</span>
                          {row.awaitingFirstResponse ? <span className="rounded bg-status-error-bg px-1.5 text-xs text-status-error-text">{t('orva_support.badge.unanswered', 'ยังไม่ตอบ')}</span> : null}
                          {row.daysOverdue > 0 ? <span className="rounded bg-status-warning-bg px-1.5 text-xs text-status-warning-text">{t('orva_support.badge.overdue', 'เลย {days} วัน').replace('{days}', String(row.daysOverdue))}</span> : null}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{label('kind', row.kind)} · {row.subject}</div>
                      </td>
                      <td className="px-3 py-2">{row.customerName ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2">{label('status', row.status)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.ageHours}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="lg:col-span-2">
            {!selected ? (
              <p className="rounded-md border p-4 text-sm text-muted-foreground">{t('orva_support.pick', 'เลือกเรื่องเพื่อดูรายละเอียดและตอบกลับ')}</p>
            ) : (
              <div className="flex flex-col gap-3 rounded-md border p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{selected.ticketNo}</span>
                    <span className={`text-xs ${priorityTone(selected.priority)}`}>{label('priority', selected.priority)}</span>
                    <span className="text-xs text-muted-foreground">{label('status', selected.status)}</span>
                  </div>
                  <div className="text-sm font-medium">{selected.subject}</div>
                  <div className="text-xs text-muted-foreground">
                    {[selected.customerName, selected.contactEmail, selected.dueOn ? `${t('orva_support.field.dueOn', 'กำหนดเสร็จ')} ${selected.dueOn}` : null, `${t('orva_support.spent', 'ใช้เวลา')} ${hours(selected.minutesSpent)} ชม.`].filter(Boolean).join(' · ')}
                  </div>
                  {selected.description ? <p className="mt-2 whitespace-pre-line text-sm">{selected.description}</p> : null}
                </div>

                <div className="flex flex-wrap gap-1">
                  {STATUSES.filter((s) => s !== selected.status).map((s) => (
                    <Button key={s} size="sm" variant="outline" disabled={busy} onClick={() => move(s)}>{label('status', s)}</Button>
                  ))}
                </div>

                <div className="max-h-64 overflow-y-auto rounded border">
                  {(replies.data?.items ?? []).length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-muted-foreground">{t('orva_support.noReplies', 'ยังไม่มีการตอบกลับ')}</p>
                  ) : (replies.data?.items ?? []).map((r) => (
                    <div key={r.id} className="border-b px-3 py-2 text-sm last:border-b-0">
                      <div className="text-xs text-muted-foreground">{label('author', r.author)} · {r.createdAt.slice(0, 16).replace('T', ' ')}{r.minutesSpent ? ` · ${r.minutesSpent} ${t('orva_support.minutes', 'นาที')}` : ''}</div>
                      <p className="whitespace-pre-line">{r.body}</p>
                    </div>
                  ))}
                </div>

                <div className="flex flex-col gap-2">
                  <textarea className="rounded-md border bg-background px-3 py-2 text-sm" rows={3} value={reply.body} onChange={(e) => setReply({ ...reply, body: e.target.value })} placeholder={t('orva_support.replyPlaceholder', 'ตอบกลับลูกค้า หรือบันทึกภายใน')} />
                  <div className="flex flex-wrap items-center gap-2">
                    <select className="rounded-md border bg-background px-2 py-1.5 text-sm" value={reply.author} onChange={(e) => setReply({ ...reply, author: e.target.value as typeof reply.author })}>
                      <option value="staff">{label('author', 'staff')}</option>
                      <option value="customer">{label('author', 'customer')}</option>
                      <option value="note">{label('author', 'note')}</option>
                    </select>
                    <Input type="number" min="0" step="5" className="w-24" value={reply.minutes || ''} onChange={(e) => setReply({ ...reply, minutes: Number(e.target.value) })} placeholder={t('orva_support.minutes', 'นาที')} />
                    <select className="rounded-md border bg-background px-2 py-1.5 text-sm" value={reply.status} onChange={(e) => setReply({ ...reply, status: e.target.value })}>
                      <option value="">{t('orva_support.keepStatus', 'คงสถานะเดิม')}</option>
                      {STATUSES.filter((s) => s !== selected.status).map((s) => <option key={s} value={s}>{label('status', s)}</option>)}
                    </select>
                    <Button size="sm" disabled={busy || !reply.body.trim()} onClick={send}>{t('orva_support.send', 'บันทึก')}</Button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </PageBody>
    </Page>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'bad' }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone === 'bad' ? 'text-status-error-text' : tone === 'warn' ? 'text-status-warning-text' : ''}`}>{value}</div>
    </div>
  )
}
