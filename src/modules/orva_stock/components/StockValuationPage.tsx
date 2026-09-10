"use client"
import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Valuation = {
  asOf: string
  lines: Array<{ lotId: string; variantId: string; variantName: string | null; sku: string | null; lotNumber: string | null; expiresAt: string | null; onHand: number; unitCost: number | null; value: number; daysToExpiry: number | null; expiryState: 'ok' | 'soon' | 'expired' | 'unknown' }>
  lowStock?: Array<{ variantId: string; productId: string; name: string; sku: string | null; onHand: number; reorderPoint: number }>
  totalOnHand: number
  totalValue: number
  uncosted: number
  expiringSoon: number
  expired: number
  unpostedCogs: { count: number; total: string }
}
type Settings = { inventoryAccountId: string | null; cogsAccountId: string | null; warehouseId: string | null; locationId: string | null; suggested: { warehouseId: string | null; locationId: string | null } }
type Account = { id: string; code: string; name: string; account_type: string }
type CogsPreview = { month: string; issues: number; total: string; periodStatus: 'open' | 'closed' | 'missing'; accountsConfigured: boolean }

const fmt = (v: number | string) => Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qty = (v: number | string) => Number(v).toLocaleString('th-TH', { maximumFractionDigits: 2 })
const prevMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7) }

/**
 * มูลค่าสินค้าคงเหลือ — every lot on hand at the cost it was bought, expiry
 * flagged, plus the month-end step: post the cost of what was sold.
 */
export default function StockValuationPage() {
  const t = useT()
  const qc = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [month, setMonth] = React.useState(prevMonth())
  const [posting, setPosting] = React.useState(false)

  const valuation = useQuery({ queryKey: ['orva_stock.valuation', scopeVersion], queryFn: () => readApiResultOrThrow<Valuation>('/api/orva_stock/valuation') })
  const settings = useQuery({ queryKey: ['orva_stock.settings', scopeVersion], queryFn: () => readApiResultOrThrow<Settings>('/api/orva_stock/settings') })
  /*
    Its own key, not the shared 'orva_finance.accounts.all'.

    Seven finance/HR screens hold that key through `fetchCrudList`, which
    caches the whole ListResponse envelope and asks for `isActive: true`. This
    one unwraps to an array and asks for every account. Two shapes in one
    React Query key means whichever screen renders first decides what the
    other reads: coming here from บัญชีแยกประเภท handed this page an envelope
    and line 71's `.filter` threw; going the other way left their account
    pickers silently empty. Different data and a different shape is a
    different key.
  */
  const accounts = useQuery({ queryKey: ['orva_stock.postingAccounts', scopeVersion], queryFn: async () => (await readApiResultOrThrow<{ items: Account[] }>('/api/orva_finance/gl/accounts?pageSize=100&sortField=code&sortDir=asc')).items })
  const cogs = useQuery({ queryKey: ['orva_stock.cogs', month, scopeVersion], queryFn: () => readApiResultOrThrow<CogsPreview>(`/api/orva_stock/cogs?month=${month}`), enabled: /^\d{4}-\d{2}$/.test(month) })

  const saveAccounts = async (patch: Partial<Settings>) => {
    const res = await apiCall('/api/orva_stock/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
    if (!res.ok) { flash((res.result as { error?: string } | undefined)?.error ?? 'failed', 'error'); return }
    flash(t('orva_stock.settings.saved', 'บันทึกการตั้งค่าแล้ว'), 'success')
    await qc.invalidateQueries({ queryKey: ['orva_stock.settings'] })
    await qc.invalidateQueries({ queryKey: ['orva_stock.cogs'] })
  }

  const postCogs = async () => {
    if (!window.confirm(t('orva_stock.cogs.confirm', 'ลงบัญชีต้นทุนขายเดือน {month} จำนวน {total} บาท?').replace('{month}', month).replace('{total}', fmt(cogs.data?.total ?? 0)))) return
    setPosting(true)
    try {
      const res = await apiCall<{ ok: boolean; journalNo: string | null; issues: number; total: string }>('/api/orva_stock/cogs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ month }) })
      if (!res.ok || !res.result) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'failed')
      flash(res.result.journalNo ? t('orva_stock.cogs.posted', 'ลงบัญชีแล้ว {journal} รวม {total} บาท').replace('{journal}', res.result.journalNo).replace('{total}', fmt(res.result.total)) : t('orva_stock.cogs.nothing', 'ไม่มีรายการขายที่ยังไม่ลงบัญชีในเดือนนี้'), 'success')
      await qc.invalidateQueries({ queryKey: ['orva_stock.cogs'] })
      await qc.invalidateQueries({ queryKey: ['orva_stock.valuation'] })
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setPosting(false)
    }
  }

  const accountOptions = (type: string) => (accounts.data ?? []).filter((a) => a.account_type === type)
  const stateLabel: Record<string, string> = {
    ok: '', soon: t('orva_stock.expiry.soon', 'ใกล้หมดอายุ'), expired: t('orva_stock.expiry.expired', 'หมดอายุแล้ว'), unknown: t('orva_stock.expiry.unknown', 'ไม่ระบุ'),
  }

  return (
    <Page>
      <PageHeader
        title={t('orva_stock.valuation.page.title', 'สินค้าคงเหลือและต้นทุน')}
        description={t('orva_stock.valuation.page.description', 'ล็อตที่มีในคลัง มูลค่าตามต้นทุนที่ซื้อมา วันหมดอายุ และการลงบัญชีต้นทุนขายรายเดือน')}
        actions={(
          <div className="flex gap-2">
            <Button asChild variant="outline"><Link href="/backend/stock/receive">{t('orva_stock.nav.receive', 'รับสินค้าเข้าคลัง')}</Link></Button>
            <Button asChild><Link href="/backend/stock/retail">{t('orva_stock.nav.retail', 'ขายปลีก')}</Link></Button>
          </div>
        )}
      />
      <PageBody>
        {valuation.error ? <div className="text-sm text-destructive">{String(valuation.error)}</div> : null}
        {valuation.data ? (
          <div className="flex flex-col gap-6">
            <div className="grid gap-3 sm:grid-cols-4">
              <Kpi label={t('orva_stock.valuation.totalValue', 'มูลค่าสินค้าคงเหลือ')} value={fmt(valuation.data.totalValue)} />
              <Kpi label={t('orva_stock.valuation.totalOnHand', 'จำนวนคงเหลือ (ชิ้น)')} value={qty(valuation.data.totalOnHand)} />
              <Kpi label={t('orva_stock.valuation.expiringSoon', 'ล็อตใกล้หมดอายุ (90 วัน)')} value={String(valuation.data.expiringSoon)} tone={valuation.data.expiringSoon > 0 ? 'warn' : undefined} />
              <Kpi label={t('orva_stock.valuation.lowStock', 'สินค้าใกล้หมด (ถึงจุดสั่งซื้อ)')} value={String((valuation.data.lowStock ?? []).length)} tone={(valuation.data.lowStock ?? []).length > 0 ? 'warn' : undefined} />
              <Kpi label={t('orva_stock.valuation.unpostedCogs', 'ต้นทุนขายรอลงบัญชี')} value={fmt(valuation.data.unpostedCogs.total)} tone={valuation.data.unpostedCogs.count > 0 ? 'warn' : undefined} />
            </div>

            {(valuation.data.lowStock ?? []).length > 0 ? (
              <section className="rounded-md border border-status-warning-border bg-status-warning-bg/40 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold">{t('orva_stock.lowStock.title', 'ใกล้หมด — ถึงจุดสั่งซื้อซ้ำแล้ว')}</h2>
                  <Button asChild size="sm"><Link href="/backend/purchasing/orders/create">{t('orva_stock.lowStock.order', 'สั่งซื้อจาก OEM')}</Link></Button>
                </div>
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {(valuation.data.lowStock ?? []).map((row) => (
                    <li key={row.variantId} className="flex items-baseline justify-between gap-3">
                      <span>{row.name}{row.sku ? <span className="ml-1 text-xs text-muted-foreground">{row.sku}</span> : null}</span>
                      <span className="tabular-nums">{t('orva_stock.lowStock.line', 'เหลือ {onHand} / จุดสั่งซื้อ {point}').replace('{onHand}', qty(row.onHand)).replace('{point}', qty(row.reorderPoint))}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">{t('orva_stock.lowStock.help', 'ตั้งจุดสั่งซื้อซ้ำได้ที่สินค้าแต่ละตัว (ช่อง "จุดสั่งซื้อซ้ำ") — เว้นว่างถ้าไม่ต้องการแจ้ง')}</p>
              </section>
            ) : null}

            <section className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="px-3 py-2">{t('orva_stock.col.product', 'สินค้า')}</th>
                    <th className="px-3 py-2">{t('orva_stock.col.lot', 'ล็อต')}</th>
                    <th className="px-3 py-2">{t('orva_stock.col.expiry', 'หมดอายุ')}</th>
                    <th className="px-3 py-2 text-right">{t('orva_stock.col.onHand', 'คงเหลือ')}</th>
                    <th className="px-3 py-2 text-right">{t('orva_stock.col.unitCost', 'ต้นทุน/หน่วย')}</th>
                    <th className="px-3 py-2 text-right">{t('orva_stock.col.value', 'มูลค่า')}</th>
                    <th className="px-3 py-2 text-right"><span className="sr-only">{t('orva_stock.valuation.printLabels', 'พิมพ์ฉลาก')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {valuation.data.lines.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">{t('orva_stock.valuation.empty', 'ยังไม่มีสินค้าในคลัง — รับล็อตแรกเข้าจากบิล OEM ได้ที่ "รับสินค้าเข้าคลัง"')}</td></tr>
                  ) : valuation.data.lines.map((l) => (
                    <tr key={l.lotId} className="border-b last:border-b-0">
                      <td className="px-3 py-2">
                        {l.variantName ?? l.sku ?? l.variantId}{l.sku ? <span className="ml-1 text-xs text-muted-foreground">{l.sku}</span> : null}
                        {(valuation.data.lowStock ?? []).some((row) => row.variantId === l.variantId) ? <span className="ml-2 rounded bg-status-warning-bg px-1.5 text-xs text-status-warning-text">{t('orva_stock.lowStock.badge', 'ใกล้หมด')}</span> : null}
                      </td>
                      <td className="px-3 py-2 font-medium">{l.lotNumber ?? '—'}</td>
                      <td className={`px-3 py-2 ${l.expiryState === 'expired' ? 'text-status-error-text' : l.expiryState === 'soon' ? 'text-status-warning-text' : ''}`}>
                        {l.expiresAt ?? '—'}{stateLabel[l.expiryState] ? ` · ${stateLabel[l.expiryState]}` : ''}{l.daysToExpiry != null && l.expiryState !== 'expired' ? ` (${l.daysToExpiry} วัน)` : ''}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{qty(l.onHand)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.unitCost == null ? <span className="text-status-warning-text">{t('orva_stock.valuation.noCost', 'ไม่มีต้นทุน')}</span> : fmt(l.unitCost)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(l.value)}</td>
                      <td className="px-3 py-2 text-right">
                        {l.lotNumber ? (
                          // The label prints on the documents rails; the lot id is the document id.
                          <Link className="text-xs text-primary hover:underline" href={`/backend/documents/preview?type=lot_label&documentId=${l.lotId}`}>
                            {t('orva_stock.valuation.printLabels', 'พิมพ์ฉลาก')}
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-md border p-4">
                <h2 className="mb-3 text-base font-semibold">{t('orva_stock.cogs.title', 'ลงบัญชีต้นทุนขายประจำเดือน')}</h2>
                <p className="mb-3 text-xs text-muted-foreground">{t('orva_stock.cogs.hint', 'ทุกการขายตัดสต็อกที่ต้นทุนของล็อตนั้น สิ้นเดือนกดครั้งเดียว: เดบิตต้นทุนขาย เครดิตสินค้าคงเหลือ รายการที่ลงแล้วจะไม่ถูกลงซ้ำ')}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" />
                  <Button onClick={postCogs} disabled={posting || !cogs.data || cogs.data.issues === 0 || !cogs.data.accountsConfigured || cogs.data.periodStatus !== 'open'}>
                    {t('orva_stock.cogs.post', 'ลงบัญชี')}
                  </Button>
                </div>
                {cogs.data ? (
                  <p className="mt-2 text-sm">
                    {t('orva_stock.cogs.preview', 'รายการขายที่ยังไม่ลงบัญชี {count} รายการ รวมต้นทุน {total} บาท').replace('{count}', String(cogs.data.issues)).replace('{total}', fmt(cogs.data.total))}
                    {cogs.data.periodStatus !== 'open' ? <span className="ml-2 text-status-warning-text">{cogs.data.periodStatus === 'missing' ? t('orva_stock.cogs.noPeriod', 'ยังไม่มีงวดบัญชีเดือนนี้') : t('orva_stock.cogs.closed', 'งวดบัญชีปิดแล้ว')}</span> : null}
                    {!cogs.data.accountsConfigured ? <span className="ml-2 text-status-warning-text">{t('orva_stock.cogs.noAccounts', 'ตั้งค่าบัญชีด้านขวาก่อน')}</span> : null}
                  </p>
                ) : null}
              </section>

              <section className="rounded-md border p-4">
                <h2 className="mb-3 text-base font-semibold">{t('orva_stock.settings.title', 'บัญชีที่ใช้ลงสต็อก')}</h2>
                <div className="flex flex-col gap-3 text-sm">
                  <label className="flex flex-col gap-1">
                    <span>{t('orva_stock.settings.inventoryAccount', 'บัญชีสินค้าคงเหลือ (สินทรัพย์)')}</span>
                    <select className="rounded-md border bg-background px-3 py-2" value={settings.data?.inventoryAccountId ?? ''} onChange={(e) => saveAccounts({ inventoryAccountId: e.target.value || null })}>
                      <option value="">—</option>
                      {accountOptions('asset').map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span>{t('orva_stock.settings.cogsAccount', 'บัญชีต้นทุนขาย (ค่าใช้จ่าย)')}</span>
                    <select className="rounded-md border bg-background px-3 py-2" value={settings.data?.cogsAccountId ?? ''} onChange={(e) => saveAccounts({ cogsAccountId: e.target.value || null })}>
                      <option value="">—</option>
                      {accountOptions('expense').map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                    </select>
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {t('orva_stock.settings.hint', 'บิลซื้อจาก OEM ให้ลงบรรทัดค่าใช้จ่ายที่บัญชีสินค้าคงเหลือนี้ (ไม่ใช่ค่าใช้จ่าย) แล้วกดรับเข้าคลังจากบิลนั้น ต้นทุนต่อหน่วยจะคำนวณให้เอง')}
                    {' '}{settings.data?.suggested.warehouseId ? t('orva_stock.settings.warehouseOk', 'คลังสินค้า: พร้อมใช้') : <Link href="/backend/wms/warehouses" className="text-status-warning-text underline">{t('orva_stock.settings.noWarehouse', 'ยังไม่มีคลังสินค้า — สร้างคลังและตำแหน่งเก็บก่อน')}</Link>}
                  </p>
                </div>
              </section>
            </div>
          </div>
        ) : null}
      </PageBody>
    </Page>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone === 'warn' ? 'text-status-warning-text' : ''}`}>{value}</div>
    </div>
  )
}
