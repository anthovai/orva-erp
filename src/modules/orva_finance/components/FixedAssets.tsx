"use client"
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { createCrud, fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type AccountOption = { id: string; code: string; name: string; account_type: string }
type PeriodOption = { id: string; code: string; status: string }
type ScheduleRow = {
  asset_id: string; code: string | null; name: string; cost: string; salvage: string; useful_life_months: number
  months_done: number; accumulated: string; net_book_value: string; next_charge: string; status: string
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'
const fmt = (v: string | number) => Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * ทะเบียนทรัพย์สินถาวร: register assets, see the straight-line schedule, and
 * book one month of depreciation per period in one click.
 */
export default function FixedAssets() {
  const t = useT()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [showForm, setShowForm] = React.useState(false)
  const [periodId, setPeriodId] = React.useState('')
  const [running, setRunning] = React.useState(false)

  const { data: accountsData } = useQuery({
    queryKey: ['orva_finance.accounts.all', scopeVersion],
    queryFn: async () => fetchCrudList<AccountOption>('orva_finance/gl/accounts', { page: 1, pageSize: 100, sortField: 'code', sortDir: 'asc', isActive: true }),
  })
  const { data: periodsData } = useQuery({
    queryKey: ['orva_finance.periods.open', scopeVersion],
    queryFn: async () => fetchCrudList<PeriodOption>('orva_finance/gl/periods', { page: 1, pageSize: 100, sortField: 'starts_on', sortDir: 'desc', status: 'open' }),
  })
  const { data: schedule, isLoading } = useQuery({
    queryKey: ['orva_finance.fa.schedule', scopeVersion],
    queryFn: async () => readApiResultOrThrow<{ items: ScheduleRow[] }>('/api/orva_finance/fa/depreciate'),
  })
  const accounts = accountsData?.items ?? []
  const byType = (type: string) => accounts.filter((a) => a.account_type === type)
  const pick = (code: string) => accounts.find((a) => a.code === code)?.id ?? ''

  // form
  const [name, setName] = React.useState('')
  const [category, setCategory] = React.useState('คอมพิวเตอร์และอุปกรณ์')
  const [acquiredOn, setAcquiredOn] = React.useState(() => new Date().toISOString().slice(0, 10))
  const [cost, setCost] = React.useState('')
  const [salvage, setSalvage] = React.useState('0')
  const [life, setLife] = React.useState('60')
  const [assetAcc, setAssetAcc] = React.useState('')
  const [accumAcc, setAccumAcc] = React.useState('')
  const [expAcc, setExpAcc] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  React.useEffect(() => {
    if (accounts.length && !assetAcc) { setAssetAcc(pick('1500')); setAccumAcc(pick('1590')); setExpAcc(pick('5400')) }
  }, [accounts.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const monthly = Number(cost) > 0 && Number(life) > 0 ? (Number(cost) - (Number(salvage) || 0)) / Number(life) : 0
  const canSave = Boolean(name.trim() && acquiredOn && Number(cost) > 0 && Number(life) > 0 && assetAcc && accumAcc && expAcc && !saving)

  const save = async () => {
    setSaving(true)
    try {
      await createCrud('orva_finance/fa/assets', {
        name: name.trim(), category: category || null, acquiredOn, cost: Number(cost), salvage: Number(salvage) || 0,
        usefulLifeMonths: Number(life), assetAccountId: assetAcc, accumDeprAccountId: accumAcc, expenseAccountId: expAcc,
      })
      flash(t('orva_finance.fa.flash.created', 'ลงทะเบียนทรัพย์สินแล้ว'), 'success')
      setShowForm(false); setName(''); setCost('')
      queryClient.invalidateQueries({ queryKey: ['orva_finance.fa.schedule'] })
    } catch (err) {
      flash(err instanceof Error ? err.message : t('orva_finance.fa.flash.createFailed', 'ลงทะเบียนไม่สำเร็จ'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const runDepreciation = async () => {
    if (!periodId) return
    setRunning(true)
    try {
      const res = await fetch('/api/orva_finance/fa/depreciate', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ periodId }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) { flash(body?.message ?? t('orva_finance.fa.flash.runFailed', 'คิดค่าเสื่อมไม่สำเร็จ'), 'error'); return }
      flash(
        body.assets > 0
          ? t('orva_finance.fa.flash.ran', 'ลงค่าเสื่อมราคาแล้ว {n} รายการ รวม {total} บาท ({journal})', { n: String(body.assets), total: fmt(body.total), journal: String(body.journalNo) })
          : t('orva_finance.fa.flash.nothing', 'ไม่มีทรัพย์สินที่ต้องคิดค่าเสื่อมในงวดนี้'),
        'success',
      )
      queryClient.invalidateQueries({ queryKey: ['orva_finance.fa.schedule'] })
    } finally {
      setRunning(false)
    }
  }

  const items = schedule?.items ?? []
  const totals = items.reduce((acc, r) => ({ cost: acc.cost + Number(r.cost), acc: acc.acc + Number(r.accumulated), nbv: acc.nbv + Number(r.net_book_value), next: acc.next + Number(r.next_charge) }), { cost: 0, acc: 0, nbv: 0, next: 0 })

  return (
    <Page>
      <PageHeader
        title={t('orva_finance.fa.page.title', 'ทะเบียนทรัพย์สินถาวร')}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <select className={`${selectClass} w-40`} value={periodId} onChange={(e) => setPeriodId(e.target.value)} aria-label={t('orva_finance.periods.column.code', 'Period')}>
              <option value="">{t('orva_finance.journals.form.selectPeriod', '— select open period —')}</option>
              {(periodsData?.items ?? []).map((p) => (<option key={p.id} value={p.id}>{p.code}</option>))}
            </select>
            <Button variant="outline" onClick={runDepreciation} disabled={!periodId || running || items.length === 0}>
              {t('orva_finance.fa.actions.depreciate', 'คิดค่าเสื่อมราคางวดนี้')}
            </Button>
            <Button onClick={() => setShowForm((v) => !v)}>{t('orva_finance.fa.actions.create', 'ลงทะเบียนทรัพย์สิน')}</Button>
          </div>
        )}
      />
      <PageBody>
        <div className="flex flex-col gap-6">
          {showForm ? (
            <div className="grid gap-3 rounded-md border p-4 text-sm md:grid-cols-3 lg:grid-cols-4">
              <label className="flex flex-col gap-1 lg:col-span-2"><span className="font-medium">{t('orva_finance.fa.form.name', 'ชื่อทรัพย์สิน')} *</span><Input value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label className="flex flex-col gap-1"><span className="font-medium">{t('orva_finance.fa.form.category', 'หมวด')}</span><Input value={category} onChange={(e) => setCategory(e.target.value)} /></label>
              <label className="flex flex-col gap-1"><span className="font-medium">{t('orva_finance.fa.form.acquiredOn', 'วันที่ได้มา')} *</span><Input type="date" value={acquiredOn} onChange={(e) => setAcquiredOn(e.target.value)} /></label>
              <label className="flex flex-col gap-1"><span className="font-medium">{t('orva_finance.fa.form.cost', 'ราคาทุน (ไม่รวม VAT)')} *</span><Input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} /></label>
              <label className="flex flex-col gap-1"><span className="font-medium">{t('orva_finance.fa.form.salvage', 'มูลค่าซาก')}</span><Input type="number" min="0" step="0.01" value={salvage} onChange={(e) => setSalvage(e.target.value)} /></label>
              <label className="flex flex-col gap-1"><span className="font-medium">{t('orva_finance.fa.form.life', 'อายุการใช้งาน (เดือน)')} *</span><Input type="number" min="1" step="1" value={life} onChange={(e) => setLife(e.target.value)} /></label>
              <div className="flex flex-col gap-1"><span className="font-medium">{t('orva_finance.fa.form.monthly', 'ค่าเสื่อม/เดือน')}</span><div className="h-9 flex items-center tabular-nums">{fmt(monthly)}</div></div>
              <label className="flex flex-col gap-1"><span className="font-medium">{t('orva_finance.fa.form.assetAccount', 'บัญชีทรัพย์สิน')} *</span>
                <select className={selectClass} value={assetAcc} onChange={(e) => setAssetAcc(e.target.value)}>{byType('asset').map((a) => (<option key={a.id} value={a.id}>{a.code} · {a.name}</option>))}</select></label>
              <label className="flex flex-col gap-1"><span className="font-medium">{t('orva_finance.fa.form.accumAccount', 'บัญชีค่าเสื่อมสะสม')} *</span>
                <select className={selectClass} value={accumAcc} onChange={(e) => setAccumAcc(e.target.value)}>{byType('asset').map((a) => (<option key={a.id} value={a.id}>{a.code} · {a.name}</option>))}</select></label>
              <label className="flex flex-col gap-1"><span className="font-medium">{t('orva_finance.fa.form.expenseAccount', 'บัญชีค่าเสื่อมราคา')} *</span>
                <select className={selectClass} value={expAcc} onChange={(e) => setExpAcc(e.target.value)}>{byType('expense').map((a) => (<option key={a.id} value={a.id}>{a.code} · {a.name}</option>))}</select></label>
              <div className="flex items-end gap-2">
                <Button onClick={save} disabled={!canSave}>{t('orva_finance.form.edit.submit', 'Save')}</Button>
                <Button variant="outline" onClick={() => setShowForm(false)}>{t('orva_finance.form.cancel', 'Cancel')}</Button>
              </div>
              <p className="text-xs text-muted-foreground md:col-span-3 lg:col-span-4">
                {t('orva_finance.fa.form.hint', 'วิธีเส้นตรง: (ราคาทุน − ซาก) ÷ อายุการใช้งาน คิดเต็มเดือนตั้งแต่เดือนที่ได้มา อัตราตามกรมสรรพากร: คอมพิวเตอร์ 3 ปี (36 เดือน) อุปกรณ์สำนักงาน 5 ปี (60 เดือน)')}
              </p>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-3 py-2">{t('orva_finance.fa.column.code', 'รหัส')}</th>
                  <th className="px-3 py-2">{t('orva_finance.fa.form.name', 'ชื่อทรัพย์สิน')}</th>
                  <th className="px-3 py-2 text-right">{t('orva_finance.fa.form.cost', 'ราคาทุน')}</th>
                  <th className="px-3 py-2 text-right">{t('orva_finance.fa.column.months', 'เดือนที่คิดแล้ว')}</th>
                  <th className="px-3 py-2 text-right">{t('orva_finance.fa.column.accumulated', 'ค่าเสื่อมสะสม')}</th>
                  <th className="px-3 py-2 text-right">{t('orva_finance.fa.column.nbv', 'มูลค่าสุทธิ')}</th>
                  <th className="px-3 py-2 text-right">{t('orva_finance.fa.column.next', 'ค่าเสื่อมงวดถัดไป')}</th>
                  <th className="px-3 py-2">{t('orva_finance.fa.column.status', 'สถานะ')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">…</td></tr> : null}
                {!isLoading && items.length === 0 ? <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">{t('orva_finance.fa.empty', 'ยังไม่มีทรัพย์สินในทะเบียน — ลงทะเบียนคอมพิวเตอร์/อุปกรณ์ที่ซื้อมาเพื่อคิดค่าเสื่อมทุกเดือน')}</td></tr> : null}
                {items.map((r) => (
                  <tr key={r.asset_id} className="border-b last:border-b-0">
                    <td className="px-3 py-2 font-medium">{r.code ?? '—'}</td>
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.cost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.months_done} / {r.useful_life_months}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.accumulated)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.net_book_value)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.next_charge)}</td>
                    <td className="px-3 py-2">{r.status === 'active' ? t('orva_finance.fa.status.active', 'ใช้งาน') : t('orva_finance.fa.status.disposed', 'จำหน่ายแล้ว')}</td>
                  </tr>
                ))}
              </tbody>
              {items.length ? (
                <tfoot>
                  <tr className="bg-muted/30 font-semibold">
                    <td className="px-3 py-2" colSpan={2}>{t('orva_finance.vat.total', 'รวม')}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.cost)}</td>
                    <td />
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.acc)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.nbv)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.next)}</td>
                    <td />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
