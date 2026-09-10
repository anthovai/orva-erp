"use client"
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useProjectOptions } from '@/modules/orva_documents/components/queries'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { useDueRetainers } from './queries'

type Subscription = {
  id: string; name: string; vendor: string | null; kind: string; cost: number; currencyCode: string
  billingCycle: string; renewsOn: string | null; autoRenew: boolean; expenseAccountCode: string | null
  customerEntityId: string | null; customerName: string | null; quoteId: string | null; notes: string | null
  status: string; lastRenewedAt: string | null
  invoiceOnRenewal: boolean; retainerAmount: number | null
  lastInvoiceId: string | null; lastInvoiceNumber: string | null; lastInvoicedAt: string | null
  daysLeft: number | null; state: 'lapsed' | 'due_soon' | 'upcoming' | null; annualCost: number
  updatedAt: string
}
type Response = { items: Subscription[]; total: number; counts: { lapsed: number; dueSoon: number; annualTotal: number; active: number } }
type Project = { quoteId: string; quoteNumber: string; customerName: string | null }

const KINDS = ['software', 'domain', 'hosting', 'certificate', 'other'] as const
const CYCLES = ['monthly', 'quarterly', 'yearly', 'one_time'] as const

const money = (value: number, currency = 'THB') =>
  `${value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`

const emptyDraft = {
  name: '', vendor: '', kind: 'software', cost: '', currencyCode: 'THB',
  billingCycle: 'yearly', renewsOn: '', autoRenew: true, expenseAccountCode: '', quoteId: '', notes: '',
}

/**
 * ทะเบียนซอฟต์แวร์และค่าบริการรายปี — the register that stops a licence,
 * domain or certificate from lapsing unnoticed and taking a client's site
 * with it. Sorted by renewal date, so whatever dies next is at the top.
 */
export default function SubscriptionsPage() {
  const t = useT()
  const qc = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [bucket, setBucket] = React.useState<'all' | 'due'>('all')
  const [search, setSearch] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const [draft, setDraft] = React.useState(emptyDraft)
  const [busy, setBusy] = React.useState(false)

  const list = useQuery({
    queryKey: ['orva_support.subscriptions', bucket, search, scopeVersion],
    queryFn: () => {
      const qs = new URLSearchParams({ bucket })
      if (search) qs.set('search', search)
      return readApiResultOrThrow<Response>(`/api/orva_support/subscriptions?${qs}`)
    },
  })
  const projects = useProjectOptions(creating)
  // Retainers whose cycle has come round. The daily scan raises a notification
  // for the same rows; the invoice is minted here, by the owner (spec A8).
  const dueRetainers = useDueRetainers()

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['orva_support.subscriptions'] }),
    qc.invalidateQueries({ queryKey: ['orva_support.retainers'] }),
  ])

  const issueRetainer = async (row: { id: string; updatedAt: string; name: string }) => {
    setBusy(true)
    try {
      const res = await apiCall<{ ok: true; invoiceNumber: string | null; nextRenewsOn: string | null }>('/api/orva_support/retainers', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: row.id, updatedAt: row.updatedAt }),
      })
      if (!res.ok || !res.result) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'failed')
      flash(t('orva_support.retainer.issued', 'ออกใบแจ้งหนี้ {number} แล้ว รอบถัดไป {date}')
        .replace('{number}', res.result.invoiceNumber ?? '')
        .replace('{date}', res.result.nextRenewsOn ?? '—'), 'success')
      await refresh()
    } catch (e) { flash(e instanceof Error ? e.message : String(e), 'error') } finally { setBusy(false) }
  }

  const create = async () => {
    if (!draft.name.trim()) { flash(t('orva_support.subscriptions.needName', 'ใส่ชื่อรายการก่อน'), 'error'); return }
    setBusy(true)
    try {
      const res = await apiCall<{ ok: true; id: string }>('/api/orva_support/subscriptions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          cost: Number(draft.cost || 0),
          vendor: draft.vendor || null,
          renewsOn: draft.renewsOn || null,
          expenseAccountCode: draft.expenseAccountCode || null,
          quoteId: draft.quoteId || null,
          notes: draft.notes || null,
        }),
      })
      if (!res.ok || !res.result) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'failed')
      flash(t('orva_support.subscriptions.created', 'เพิ่มรายการแล้ว'), 'success')
      setCreating(false)
      setDraft(emptyDraft)
      await refresh()
    } catch (e) { flash(e instanceof Error ? e.message : String(e), 'error') } finally { setBusy(false) }
  }

  const put = async (row: Subscription, body: Record<string, unknown>, done: string) => {
    setBusy(true)
    try {
      const res = await apiCall<{ ok: true }>('/api/orva_support/subscriptions', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: row.id, updatedAt: row.updatedAt, ...body }),
      })
      if (!res.ok || !res.result) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'failed')
      flash(done, 'success')
      await refresh()
    } catch (e) { flash(e instanceof Error ? e.message : String(e), 'error') } finally { setBusy(false) }
  }

  const label = (group: string, value: string) => t(`orva_support.subscriptions.${group}.${value}`, value)

  const stateTone = (row: Subscription) =>
    row.status !== 'active' ? 'text-muted-foreground'
      : row.state === 'lapsed' ? 'text-status-error-text'
      : row.state === 'due_soon' ? 'text-status-warning-text'
      : ''

  const whenText = (row: Subscription) => {
    if (!row.renewsOn) return t('orva_support.subscriptions.noRenewal', 'ไม่มีรอบต่ออายุ')
    if (row.daysLeft == null) return row.renewsOn
    if (row.daysLeft < 0) return t('orva_support.subscriptions.lapsedDays', 'เลยกำหนด {days} วัน').replace('{days}', String(-row.daysLeft))
    if (row.daysLeft === 0) return t('orva_support.subscriptions.today', 'ครบกำหนดวันนี้')
    return t('orva_support.subscriptions.inDays', 'อีก {days} วัน').replace('{days}', String(row.daysLeft))
  }

  return (
    <Page>
      <PageHeader
        title={t('orva_support.subscriptions.page.title', 'ซอฟต์แวร์และค่าบริการรายปี')}
        description={t('orva_support.subscriptions.page.description', 'ทะเบียนไลเซนส์ โดเมน โฮสติ้งและใบรับรอง — เรียงตามวันต่ออายุ เพื่อไม่ให้ของหมดอายุเงียบๆ แล้วเว็บลูกค้าล่ม')}
        actions={<Button onClick={() => setCreating((v) => !v)}>{t('orva_support.subscriptions.new', 'เพิ่มรายการ')}</Button>}
      />
      <PageBody>
        {list.data ? (
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <Kpi label={t('orva_support.subscriptions.kpi.lapsed', 'เลยกำหนดต่ออายุ')} value={String(list.data.counts.lapsed)} tone={list.data.counts.lapsed > 0 ? 'bad' : undefined} />
            <Kpi label={t('orva_support.subscriptions.kpi.dueSoon', 'ต่ออายุใน 30 วัน')} value={String(list.data.counts.dueSoon)} tone={list.data.counts.dueSoon > 0 ? 'warn' : undefined} />
            <Kpi label={t('orva_support.subscriptions.kpi.active', 'รายการที่ใช้อยู่')} value={String(list.data.counts.active)} />
            <Kpi label={t('orva_support.subscriptions.kpi.annual', 'ค่าใช้จ่ายต่อปี')} value={money(list.data.counts.annualTotal)} />
          </div>
        ) : null}

        {dueRetainers.data?.items.length ? (
          <section className="mb-4 rounded-md border border-status-warning-border bg-status-warning-bg/40 p-4" aria-labelledby="retainers-due-title" data-testid="retainers-due">
            <h2 id="retainers-due-title" className="text-sm font-semibold text-status-warning-text">
              {t('orva_support.retainer.dueTitle', 'ถึงรอบออกใบแจ้งหนี้ค่าดูแลระบบ {n} รายการ').replace('{n}', String(dueRetainers.data.items.length))}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('orva_support.retainer.dueNote', 'ระบบไม่ออกใบแจ้งหนี้เอง — กดออกเมื่อพร้อม แล้ววันต่ออายุจะเลื่อนไปรอบถัดไปให้')}
            </p>
            <ul className="mt-3 space-y-2">
              {dueRetainers.data.items.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    <span className="font-medium">{row.name}</span>
                    <span className="text-muted-foreground">
                      {' '}· {row.customerName ?? t('orva_support.retainer.noCustomer', 'ไม่ระบุลูกค้า')} · {t('orva_support.retainer.cycleOf', 'รอบ {date}').replace('{date}', row.renewsOn ?? '—')}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">{money(row.amount)}</span>
                    <Button size="sm" disabled={busy} onClick={() => issueRetainer(row)} data-testid={`issue-retainer-${row.id}`}>
                      {t('orva_support.retainer.issue', 'ออกใบแจ้งหนี้')}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {creating ? (
          <form className="mb-4 grid gap-3 rounded-md border p-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void create() }}>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t('orva_support.subscriptions.field.name', 'ชื่อรายการ')}</span>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required maxLength={200} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t('orva_support.subscriptions.field.vendor', 'ผู้ให้บริการ')}</span>
              <Input value={draft.vendor} onChange={(e) => setDraft({ ...draft, vendor: e.target.value })} maxLength={200} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t('orva_support.subscriptions.field.kind', 'ประเภท')}</span>
              <select className="rounded-md border bg-background px-3 py-2" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                {KINDS.map((k) => <option key={k} value={k}>{label('kind', k)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t('orva_support.subscriptions.field.cycle', 'รอบชำระ')}</span>
              <select className="rounded-md border bg-background px-3 py-2" value={draft.billingCycle} onChange={(e) => setDraft({ ...draft, billingCycle: e.target.value })}>
                {CYCLES.map((c) => <option key={c} value={c}>{label('cycle', c)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t('orva_support.subscriptions.field.cost', 'ค่าบริการต่อรอบ')}</span>
              <Input type="number" min="0" step="0.01" value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t('orva_support.subscriptions.field.renewsOn', 'วันต่ออายุครั้งถัดไป')}</span>
              <Input type="date" value={draft.renewsOn} onChange={(e) => setDraft({ ...draft, renewsOn: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t('orva_support.subscriptions.field.project', 'โปรเจกต์ที่ใช้')}</span>
              <select className="rounded-md border bg-background px-3 py-2" value={draft.quoteId} onChange={(e) => setDraft({ ...draft, quoteId: e.target.value })}>
                <option value="">—</option>
                {(projects.data ?? []).map((p) => (
                  <option key={p.quoteId} value={p.quoteId}>{p.quoteNumber}{p.customerName ? ` — ${p.customerName}` : ''}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t('orva_support.subscriptions.field.account', 'รหัสบัญชีค่าใช้จ่าย')}</span>
              <Input value={draft.expenseAccountCode} onChange={(e) => setDraft({ ...draft, expenseAccountCode: e.target.value })} placeholder="5700" maxLength={40} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.autoRenew} onChange={(e) => setDraft({ ...draft, autoRenew: e.target.checked })} />
              <span>{t('orva_support.subscriptions.field.autoRenew', 'ตัดเงินอัตโนมัติ')}</span>
            </label>
            <label className="flex flex-col gap-1 text-sm md:col-span-2">
              <span>{t('orva_support.subscriptions.field.notes', 'หมายเหตุ')}</span>
              <textarea className="rounded-md border bg-background px-3 py-2" rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </label>
            <div className="flex items-end gap-2 md:col-span-2">
              <Button type="submit" disabled={busy}>{t('orva_support.subscriptions.create', 'เพิ่ม')}</Button>
              <Button type="button" variant="outline" onClick={() => setCreating(false)} disabled={busy}>{t('orva_support.cancel', 'ยกเลิก')}</Button>
            </div>
          </form>
        ) : null}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select className="rounded-md border bg-background px-3 py-2 text-sm" value={bucket} onChange={(e) => setBucket(e.target.value as 'all' | 'due')}>
            <option value="all">{t('orva_support.subscriptions.filter.all', 'ทั้งหมด')}</option>
            <option value="due">{t('orva_support.subscriptions.filter.due', 'ที่ต้องต่ออายุ')}</option>
          </select>
          <Input className="max-w-64" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('orva_support.subscriptions.search', 'ค้นหาชื่อ / ผู้ให้บริการ')} />
        </div>

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="px-3 py-2">{t('orva_support.subscriptions.col.item', 'รายการ')}</th>
                <th className="px-3 py-2">{t('orva_support.subscriptions.col.renewal', 'ต่ออายุ')}</th>
                <th className="px-3 py-2 text-right">{t('orva_support.subscriptions.col.cost', 'ค่าบริการ')}</th>
                <th className="px-3 py-2 text-right">{t('orva_support.subscriptions.col.annual', 'ต่อปี')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {list.isLoading ? <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">…</td></tr> : null}
              {list.data?.items.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">{t('orva_support.subscriptions.empty', 'ยังไม่มีรายการในทะเบียน')}</td></tr>
              ) : null}
              {(list.data?.items ?? []).map((row) => (
                <tr key={row.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{row.name}</span>
                      <span className="text-xs text-muted-foreground">{label('kind', row.kind)}</span>
                      {!row.autoRenew ? <span className="rounded bg-status-warning-bg px-1.5 text-xs text-status-warning-text">{t('orva_support.subscriptions.manual', 'ต่อเอง')}</span> : null}
                      {row.status !== 'active' ? <span className="rounded bg-muted px-1.5 text-xs text-muted-foreground">{t('orva_support.subscriptions.cancelled', 'ยกเลิกแล้ว')}</span> : null}
                      {row.invoiceOnRenewal ? <span className="rounded bg-status-info-bg px-1.5 text-xs text-status-info-text">{t('orva_support.retainer.badge', 'ค่าดูแลระบบ (เราเก็บ)')}</span> : null}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[row.vendor, row.customerName, row.expenseAccountCode].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </td>
                  <td className={`px-3 py-2 ${stateTone(row)}`}>
                    <div className="tabular-nums">{row.renewsOn ?? '—'}</div>
                    <div className="text-xs">{whenText(row)}</div>
                    {row.lastInvoiceNumber ? (
                      <div className="text-xs text-muted-foreground">
                        {t('orva_support.retainer.lastInvoice', 'ใบล่าสุด {number}').replace('{number}', row.lastInvoiceNumber)}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {money(row.cost, row.currencyCode)}
                    <div className="text-xs text-muted-foreground">{label('cycle', row.billingCycle)}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.annualCost > 0 ? money(row.annualCost, row.currencyCode) : '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {row.customerEntityId && row.quoteId ? (
                        <SwitchField
                          id={`retainer-${row.id}`}
                          checked={row.invoiceOnRenewal}
                          disabled={busy}
                          onCheckedChange={(next) => put(row, { invoiceOnRenewal: Boolean(next) }, Boolean(next)
                            ? t('orva_support.retainer.on', 'จะแจ้งเตือนให้ออกใบแจ้งหนี้ทุกรอบ')
                            : t('orva_support.retainer.off', 'เลิกแจ้งเตือนรอบค่าดูแลระบบ'))}
                          label={t('orva_support.retainer.toggle', 'เก็บค่าดูแล')}
                        />
                      ) : null}
                      {row.status === 'active' && row.renewsOn && row.billingCycle !== 'one_time' ? (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => put(row, { markRenewed: true }, t('orva_support.subscriptions.renewed', 'เลื่อนวันต่ออายุแล้ว'))}>
                          {t('orva_support.subscriptions.action.renewed', 'ต่ออายุแล้ว')}
                        </Button>
                      ) : null}
                      {row.status === 'active' ? (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => put(row, { status: 'cancelled' }, t('orva_support.subscriptions.didCancel', 'ยกเลิกรายการแล้ว'))}>
                          {t('orva_support.subscriptions.action.cancel', 'ยกเลิก')}
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => put(row, { status: 'active' }, t('orva_support.subscriptions.didReactivate', 'กลับมาใช้งานแล้ว'))}>
                          {t('orva_support.subscriptions.action.reactivate', 'ใช้งานต่อ')}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
