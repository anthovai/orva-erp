"use client"
import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@/components/orva/Page'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Button } from '@open-mercato/ui/primitives/button'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useBrandCodes } from '@/modules/orva_documents/components/queries'
import { OrvaEmptyState } from '@/components/orva/NodeMark'
import { selectClass } from '@/modules/orva_purchasing/components/pickers'

type Marketplace = 'shopee' | 'lazada' | 'tiktok' | 'custom'
type MappingField = 'orderId' | 'sku' | 'quantity' | 'unitPrice' | 'orderDate' | 'status' | 'buyerName' | 'productName'
type PreviewOrder = {
  externalOrderId: string; orderDate: string | null; status: string | null; buyerName: string | null
  resolution: 'ready' | 'imported' | 'skipped'; reason: string | null; gross: number
  lines: Array<{ sku: string; productName: string | null; quantity: number; unitPrice: number }>
  lots: Array<{ sku: string; lotNumber: string | null; quantity: number }>
}
type Preview = {
  headers: string[]; mapping: Partial<Record<MappingField, string>>; rowCount: number; problems: string[]
  summary: { ready: number; imported: number; skipped: number; gross: number }; orders: PreviewOrder[]
}
type ImportResult = { externalOrderId: string; status: 'imported' | 'skipped' | 'failed'; invoiceId?: string; invoiceNumber?: string; gross?: number; message?: string }
type HistoryRow = { id: string; marketplace: string; externalOrderId: string; status: string; invoiceId: string | null; invoiceNumber: string | null; orderDate: string | null; buyerName: string | null; gross: string | null; message: string | null; createdAt: string }

const MARKETPLACES: Array<{ id: Marketplace; label: string }> = [
  { id: 'shopee', label: 'Shopee' }, { id: 'lazada', label: 'Lazada' }, { id: 'tiktok', label: 'TikTok Shop' }, { id: 'custom', label: 'ไฟล์อื่น (กำหนดคอลัมน์เอง)' },
]
const FIELDS: Array<{ id: MappingField; required: boolean }> = [
  { id: 'orderId', required: true }, { id: 'sku', required: true }, { id: 'unitPrice', required: true },
  { id: 'quantity', required: false }, { id: 'orderDate', required: false }, { id: 'status', required: false },
  { id: 'buyerName', required: false }, { id: 'productName', required: false },
]
const fmt = (v: number | string) => Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qty = (v: number) => Number(v).toLocaleString('th-TH', { maximumFractionDigits: 2 })

/**
 * นำเข้าออเดอร์จากมาร์เก็ตเพลส — the order export the owner already downloads
 * from the seller centre becomes retail sales: one invoice per order, paid as
 * "มาร์เก็ตเพลส", stock issued from lots, COGS queued. Nothing is written
 * until the preview has been read; an order already imported is skipped, and
 * the reason for every skip is on the row.
 */
export default function MarketplaceImportPage() {
  const t = useT()
  const qc = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [marketplace, setMarketplace] = React.useState<Marketplace>('shopee')
  const [brand, setBrand] = React.useState('MRV')
  const [file, setFile] = React.useState<File | null>(null)
  const [priceIsLineTotal, setPriceIsLineTotal] = React.useState(false)
  const [overrides, setOverrides] = React.useState<Partial<Record<MappingField, string>>>({})
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [previewing, setPreviewing] = React.useState(false)
  const [importing, setImporting] = React.useState(false)
  const [results, setResults] = React.useState<ImportResult[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)

  const brands = useBrandCodes()
  const history = useQuery({
    queryKey: ['orva_stock.marketplaceImports', scopeVersion],
    queryFn: async () => (await readApiResultOrThrow<{ items: HistoryRow[] }>('/api/orva_stock/marketplace-import?pageSize=100')).items,
  })

  const label = (field: MappingField) => t(`orva_stock.marketplace.field.${field}`, field)

  const runPreview = React.useCallback(async (nextOverrides = overrides, nextPriceIsLineTotal = priceIsLineTotal) => {
    if (!file) return
    setPreviewing(true)
    setError(null)
    setResults(null)
    try {
      const fd = new FormData()
      fd.set('file', file)
      fd.set('marketplace', marketplace)
      fd.set('mapping', JSON.stringify(nextOverrides))
      fd.set('priceIsLineTotal', nextPriceIsLineTotal ? '1' : '0')
      const res = await apiCall<Preview>('/api/orva_stock/marketplace-import/preview', { method: 'POST', body: fd })
      if (!res.ok || !res.result) throw new Error((res.result as { error?: string } | undefined)?.error ?? t('orva_stock.marketplace.previewFailed', 'อ่านไฟล์ไม่สำเร็จ'))
      setPreview(res.result)
    } catch (e) {
      setPreview(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPreviewing(false)
    }
  }, [file, marketplace, overrides, priceIsLineTotal, t])

  const changeMapping = (field: MappingField, header: string) => {
    const next = { ...overrides, [field]: header }
    setOverrides(next)
    void runPreview(next)
  }

  const runImport = async () => {
    if (!preview) return
    const ready = preview.orders.filter((o) => o.resolution === 'ready')
    if (ready.length === 0) return
    setImporting(true)
    setError(null)
    try {
      const res = await apiCall<{ ok: true; results: ImportResult[]; summary: { imported: number; skipped: number; failed: number; gross: number } }>('/api/orva_stock/marketplace-import', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          marketplace, brand,
          orders: ready.map((o) => ({ externalOrderId: o.externalOrderId, orderDate: o.orderDate, buyerName: o.buyerName, lines: o.lines })),
        }),
      })
      if (!res.ok || !res.result) throw new Error((res.result as { error?: string } | undefined)?.error ?? t('orva_stock.marketplace.importFailed', 'นำเข้าไม่สำเร็จ'))
      setResults(res.result.results)
      setPreview(null)
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      flash(t('orva_stock.marketplace.done', 'นำเข้า {n} ออเดอร์ รวม {gross} บาท').replace('{n}', String(res.result.summary.imported)).replace('{gross}', fmt(res.result.summary.gross)), res.result.summary.failed > 0 ? 'error' : 'success')
      await qc.invalidateQueries({ queryKey: ['orva_stock.marketplaceImports'] })
      await qc.invalidateQueries({ queryKey: ['orva_stock.lots'] })
      await qc.invalidateQueries({ queryKey: ['orva_stock.valuation'] })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  const tone = (resolution: PreviewOrder['resolution']) =>
    resolution === 'ready' ? 'bg-status-success-bg text-status-success-text' : resolution === 'imported' ? 'bg-muted text-muted-foreground' : 'bg-status-warning-bg text-status-warning-text'
  const resolutionLabel = (resolution: PreviewOrder['resolution']) =>
    resolution === 'ready' ? t('orva_stock.marketplace.ready', 'พร้อมนำเข้า') : resolution === 'imported' ? t('orva_stock.marketplace.alreadyImported', 'นำเข้าแล้ว') : t('orva_stock.marketplace.skipped', 'ข้าม')

  return (
    <Page>
      <PageHeader
        title={t('orva_stock.marketplace.page.title', 'นำเข้าออเดอร์จากมาร์เก็ตเพลส')}
        description={t('orva_stock.marketplace.page.description', 'อัปโหลดไฟล์ออเดอร์ที่ดาวน์โหลดจาก Shopee / Lazada / TikTok — ทุกออเดอร์กลายเป็นการขายปลีก: ใบกำกับภาษีอย่างย่อ รับเงิน ตัดสต็อกจากล็อต ครบในครั้งเดียว ออเดอร์ที่เคยนำเข้าแล้วจะถูกข้ามเอง')}
      />
      <PageBody>
        <div className="flex flex-col gap-6">
          {/* ขั้นที่ 1 — the file */}
          <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
            <div>
              <p className="orva-kicker">{t('orva_stock.marketplace.step1.kicker', 'ขั้นที่ 1')}</p>
              <h2 className="text-base font-semibold">{t('orva_stock.marketplace.step1.title', 'เลือกไฟล์ออเดอร์')}</h2>
              <p className="text-sm text-muted-foreground">{t('orva_stock.marketplace.step1.hint', 'ไฟล์ .xlsx หรือ .csv จาก Seller Centre (Shopee: คำสั่งซื้อ → ดาวน์โหลด, Lazada: Orders → Export, TikTok: Orders → Export) — ยังไม่มีอะไรถูกบันทึกจนกว่าจะกดนำเข้าในขั้นที่ 3')}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label={t('orva_stock.marketplace.marketplace', 'มาร์เก็ตเพลส')} required>
                <select className={selectClass} value={marketplace} onChange={(e) => { setMarketplace(e.target.value as Marketplace); setOverrides({}); setPreview(null) }}>
                  {MARKETPLACES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </FormField>
              <FormField label={t('orva_stock.marketplace.brand', 'ออกใบกำกับในแบรนด์')} required description={t('orva_stock.marketplace.brandHelp', 'เลขที่เอกสารจะรันตามแบรนด์นี้')}>
                {brands.isLoading ? <Skeleton className="h-9 w-full" /> : (
                  <select className={selectClass} value={brand} onChange={(e) => setBrand(e.target.value)}>
                    {(brands.data ?? []).map((b) => <option key={b.code} value={b.code}>{b.code} · {b.name}</option>)}
                    {(brands.data ?? []).length === 0 ? <option value="MRV">MRV</option> : null}
                  </select>
                )}
              </FormField>
              <FormField label={t('orva_stock.marketplace.file', 'ไฟล์ออเดอร์')} required>
                <input ref={fileRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResults(null) }} />
              </FormField>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={() => void runPreview()} disabled={!file || previewing}>{previewing ? t('orva_stock.marketplace.previewing', 'กำลังอ่านไฟล์…') : t('orva_stock.marketplace.preview', 'อ่านไฟล์และตรวจก่อนนำเข้า')}</Button>
              <SwitchField
                checked={priceIsLineTotal}
                onCheckedChange={(checked) => { setPriceIsLineTotal(checked); if (preview) void runPreview(overrides, checked) }}
                label={t('orva_stock.marketplace.priceIsLineTotal', 'ราคาในไฟล์เป็นยอดรวมต่อบรรทัด (ไม่ใช่ต่อชิ้น)')}
              />
            </div>
            {error ? <Alert status="error">{error}</Alert> : null}
          </section>

          {/* ขั้นที่ 2 — what was read */}
          {preview ? (
            <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
              <div>
                <p className="orva-kicker">{t('orva_stock.marketplace.step2.kicker', 'ขั้นที่ 2')}</p>
                <h2 className="text-base font-semibold">{t('orva_stock.marketplace.step2.title', 'ตรวจสิ่งที่อ่านได้')}</h2>
                <p className="text-sm text-muted-foreground">
                  {t('orva_stock.marketplace.step2.hint', 'อ่านได้ {rows} แถว → {orders} ออเดอร์ · พร้อมนำเข้า {ready} · นำเข้าแล้ว {imported} · ต้องดู {skipped}')
                    .replace('{rows}', String(preview.rowCount)).replace('{orders}', String(preview.orders.length))
                    .replace('{ready}', String(preview.summary.ready)).replace('{imported}', String(preview.summary.imported)).replace('{skipped}', String(preview.summary.skipped))}
                </p>
              </div>
              <details className="rounded-md border p-3 text-sm" open={FIELDS.some((f) => f.required && !preview.mapping[f.id])}>
                <summary className="cursor-pointer font-medium">{t('orva_stock.marketplace.mapping', 'คอลัมน์ที่ใช้ (แก้ได้ถ้าอ่านผิด)')}</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {FIELDS.map((field) => (
                    <FormField key={field.id} label={label(field.id)} required={field.required}>
                      <select className={selectClass} value={preview.mapping[field.id] ?? ''} onChange={(e) => changeMapping(field.id, e.target.value)}>
                        <option value="">{t('orva_stock.marketplace.noColumn', '— ไม่ใช้ —')}</option>
                        {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </FormField>
                  ))}
                </div>
              </details>
              {preview.problems.length > 0 ? (
                <Alert status="warning">{preview.problems.slice(0, 5).join(' · ')}{preview.problems.length > 5 ? ` … (+${preview.problems.length - 5})` : ''}</Alert>
              ) : null}
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('orva_stock.marketplace.col.order', 'ออเดอร์')}</TableHead>
                      <TableHead>{t('orva_stock.marketplace.col.date', 'วันที่')}</TableHead>
                      <TableHead>{t('orva_stock.marketplace.col.buyer', 'ผู้ซื้อ')}</TableHead>
                      <TableHead>{t('orva_stock.marketplace.col.lines', 'สินค้า')}</TableHead>
                      <TableHead className="text-right">{t('orva_stock.marketplace.col.gross', 'ยอด (รวม VAT)')}</TableHead>
                      <TableHead>{t('orva_stock.marketplace.col.result', 'ผล')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.orders.map((o) => (
                      <TableRow key={o.externalOrderId}>
                        <TableCell className="font-medium">{o.externalOrderId}{o.status ? <div className="text-xs text-muted-foreground">{o.status}</div> : null}</TableCell>
                        <TableCell className="whitespace-nowrap">{o.orderDate ?? '—'}</TableCell>
                        <TableCell>{o.buyerName ?? '—'}</TableCell>
                        <TableCell>
                          {o.lines.map((l) => (
                            <div key={l.sku} className="text-xs">
                              <span className="font-medium">{l.sku}</span> × {qty(l.quantity)} @ {fmt(l.unitPrice)}
                              {o.lots.filter((lot) => lot.sku === l.sku).length > 0 ? <span className="text-muted-foreground"> · {t('orva_stock.marketplace.lot', 'ล็อต')} {o.lots.filter((lot) => lot.sku === l.sku).map((lot) => `${lot.lotNumber ?? '?'}×${qty(lot.quantity)}`).join(', ')}</span> : null}
                            </div>
                          ))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(o.gross)}</TableCell>
                        <TableCell>
                          <span className={`rounded px-1.5 text-xs ${tone(o.resolution)}`}>{resolutionLabel(o.resolution)}</span>
                          {o.reason ? <div className="text-xs text-muted-foreground">{o.reason}</div> : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* ขั้นที่ 3 — write */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                <p className="text-sm">
                  <span className="orva-kicker mr-2">{t('orva_stock.marketplace.step3.kicker', 'ขั้นที่ 3')}</span>
                  {t('orva_stock.marketplace.step3.summary', 'จะนำเข้า {n} ออเดอร์ รวม {gross} บาท — ออกใบกำกับภาษีอย่างย่อ รับเงินเป็นมาร์เก็ตเพลส และตัดสต็อก').replace('{n}', String(preview.summary.ready)).replace('{gross}', fmt(preview.summary.gross))}
                </p>
                <Button type="button" onClick={runImport} disabled={importing || preview.summary.ready === 0}>{importing ? t('orva_stock.marketplace.importing', 'กำลังนำเข้า…') : t('orva_stock.marketplace.import', 'นำเข้า {n} ออเดอร์').replace('{n}', String(preview.summary.ready))}</Button>
              </div>
            </section>
          ) : null}

          {results ? (
            <section className="flex flex-col gap-2 rounded-lg border bg-card p-4">
              <h2 className="text-base font-semibold">{t('orva_stock.marketplace.results', 'ผลการนำเข้า')}</h2>
              <ul className="flex flex-col gap-1 text-sm">
                {results.map((r) => (
                  <li key={r.externalOrderId} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span><span className="font-medium">{r.externalOrderId}</span>{r.message ? <span className="ml-2 text-xs text-muted-foreground">{r.message}</span> : null}</span>
                    {r.status === 'imported' && r.invoiceId ? (
                      <Link href={`/backend/documents/preview?type=abbreviated_tax_invoice&documentId=${r.invoiceId}`} className="text-primary hover:underline">{r.invoiceNumber} · {fmt(r.gross ?? 0)}</Link>
                    ) : <span className={`rounded px-1.5 text-xs ${r.status === 'failed' ? 'bg-status-error-bg text-status-error-text' : 'bg-muted text-muted-foreground'}`}>{r.status === 'failed' ? t('orva_stock.marketplace.failed', 'ไม่สำเร็จ') : t('orva_stock.marketplace.skipped', 'ข้าม')}</span>}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="flex flex-col gap-3">
            <SectionHeader title={t('orva_stock.marketplace.history', 'ออเดอร์ที่นำเข้าแล้ว')} count={(history.data ?? []).length} />
            {history.isLoading ? <Skeleton shape="text" lines={3} /> : (history.data ?? []).length === 0 ? (
              <OrvaEmptyState title={t('orva_stock.marketplace.historyEmpty', 'ยังไม่เคยนำเข้าออเดอร์')} description={t('orva_stock.marketplace.historyEmptyHelp', 'ดาวน์โหลดไฟล์ออเดอร์จาก Seller Centre แล้วอัปโหลดในขั้นที่ 1 — ทุกออเดอร์จะกลายเป็นใบกำกับภาษีและตัดสต็อกให้เอง')} />
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('orva_stock.marketplace.col.when', 'นำเข้าเมื่อ')}</TableHead>
                      <TableHead>{t('orva_stock.marketplace.marketplace', 'มาร์เก็ตเพลส')}</TableHead>
                      <TableHead>{t('orva_stock.marketplace.col.order', 'ออเดอร์')}</TableHead>
                      <TableHead>{t('orva_stock.marketplace.col.buyer', 'ผู้ซื้อ')}</TableHead>
                      <TableHead className="text-right">{t('orva_stock.marketplace.col.gross', 'ยอด (รวม VAT)')}</TableHead>
                      <TableHead>{t('orva_stock.marketplace.col.invoice', 'ใบกำกับ')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(history.data ?? []).map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{row.createdAt.slice(0, 16).replace('T', ' ')}</TableCell>
                        <TableCell>{MARKETPLACES.find((m) => m.id === row.marketplace)?.label ?? row.marketplace}</TableCell>
                        <TableCell className="font-medium">{row.externalOrderId}{row.orderDate ? <div className="text-xs text-muted-foreground">{row.orderDate}</div> : null}</TableCell>
                        <TableCell>{row.buyerName ?? '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.gross ? fmt(row.gross) : '—'}</TableCell>
                        <TableCell>
                          {row.status === 'imported' && row.invoiceId ? (
                            <Link href={`/backend/documents/preview?type=abbreviated_tax_invoice&documentId=${row.invoiceId}`} className="text-primary hover:underline">{row.invoiceNumber}</Link>
                          ) : <span className="rounded bg-status-error-bg px-1.5 text-xs text-status-error-text" title={row.message ?? undefined}>{t('orva_stock.marketplace.failed', 'ไม่สำเร็จ')}{row.message ? ` · ${row.message}` : ''}</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </div>
      </PageBody>
    </Page>
  )
}
