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

type Lot = { lotId: string; catalogVariantId: string; variantName: string | null; sku: string | null; lotNumber: string | null; expiresAt: string | null; onHand: string; unitCost: string | null }
type Brand = { code: string; name: string }
type CartLine = { lot: Lot; quantity: number; unitPriceGross: number }
type SaleResult = { ok: true; invoiceId: string; invoiceNumber: string; gross: number; net: number; vat: number; documents: { abbreviatedTaxInvoice: string; receipt: string } }

const fmt = (v: number | string) => Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const today = () => new Date().toISOString().slice(0, 10)

/**
 * ขายปลีก — the Marventine counter: pick lots (soonest expiry first), shelf
 * prices include VAT, payment now; one click creates the brand-series
 * invoice, books the receipt, issues stock and hands back the
 * ใบกำกับภาษีอย่างย่อ to print or send.
 */
export default function RetailSalePage() {
  const t = useT()
  const qc = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [cart, setCart] = React.useState<CartLine[]>([])
  const [customerName, setCustomerName] = React.useState('')
  const [customerPhone, setCustomerPhone] = React.useState('')
  const [paymentMethod, setPaymentMethod] = React.useState<'cash' | 'transfer' | 'marketplace'>('transfer')
  const [reference, setReference] = React.useState('')
  const [soldOn, setSoldOn] = React.useState(today())
  const [brand, setBrand] = React.useState('MRV')
  const [saving, setSaving] = React.useState(false)
  const [result, setResult] = React.useState<SaleResult | null>(null)

  const lots = useQuery({ queryKey: ['orva_stock.lots', scopeVersion], queryFn: async () => (await readApiResultOrThrow<{ items: Lot[] }>('/api/orva_stock/lots')).items })
  const brands = useQuery({ queryKey: ['orva_documents.brands.codes', scopeVersion], queryFn: async () => (await readApiResultOrThrow<{ items: Brand[] }>('/api/orva_documents/brands')).items })

  const add = (lot: Lot) => setCart((c) => (c.some((l) => l.lot.lotId === lot.lotId) ? c : [...c, { lot, quantity: 1, unitPriceGross: 0 }]))
  const update = (lotId: string, patch: Partial<CartLine>) => setCart((c) => c.map((l) => (l.lot.lotId === lotId ? { ...l, ...patch } : l)))
  const remove = (lotId: string) => setCart((c) => c.filter((l) => l.lot.lotId !== lotId))
  const gross = cart.reduce((s, l) => s + l.quantity * l.unitPriceGross, 0)
  const vat = Math.round((gross - gross / 1.07) * 100) / 100

  const submit = async () => {
    if (!cart.length) return
    if (cart.some((l) => l.quantity <= 0 || l.unitPriceGross <= 0)) { flash(t('orva_stock.retail.invalidLine', 'ใส่จำนวนและราคาให้ครบทุกบรรทัด'), 'error'); return }
    setSaving(true)
    try {
      const res = await apiCall<SaleResult>('/api/orva_stock/retail-sale', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brand, soldOn, paymentMethod, reference: reference || null,
          customerName: customerName || null, customerPhone: customerPhone || null,
          lines: cart.map((l) => ({ catalogVariantId: l.lot.catalogVariantId, lotId: l.lot.lotId, name: l.lot.variantName ?? l.lot.sku ?? 'สินค้า', sku: l.lot.sku, quantity: l.quantity, unitPriceGross: l.unitPriceGross })),
        }),
      })
      if (!res.ok || !res.result) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'failed')
      setResult(res.result)
      setCart([]); setCustomerName(''); setCustomerPhone(''); setReference('')
      flash(t('orva_stock.retail.done', 'บันทึกการขาย {number} รวม {gross} บาท แล้ว').replace('{number}', res.result.invoiceNumber).replace('{gross}', fmt(res.result.gross)), 'success')
      await qc.invalidateQueries({ queryKey: ['orva_stock.lots'] })
      await qc.invalidateQueries({ queryKey: ['orva_stock.valuation'] })
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Page>
      <PageHeader
        title={t('orva_stock.retail.page.title', 'ขายปลีก')}
        description={t('orva_stock.retail.page.description', 'ราคาหน้าร้านรวม VAT ลูกค้าไม่ต้องระบุชื่อ รับเงินทันที — ระบบออกใบกำกับภาษีอย่างย่อ ลงบัญชี และตัดสต็อกจากล็อตให้ครบในคลิกเดียว')}
        actions={<Button asChild variant="outline"><Link href="/backend/stock/valuation">{t('orva_stock.nav.valuation', 'สินค้าคงเหลือ')}</Link></Button>}
      />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-5">
          <section className="lg:col-span-2">
            <h2 className="mb-2 text-sm font-semibold">{t('orva_stock.retail.lots', 'ล็อตที่มีในคลัง (หมดอายุก่อนขึ้นก่อน)')}</h2>
            <div className="max-h-128 overflow-y-auto rounded-md border text-sm">
              {(lots.data ?? []).length === 0 ? (
                <div className="px-3 py-6 text-center text-muted-foreground">{t('orva_stock.retail.noStock', 'ยังไม่มีสินค้าในคลัง')}</div>
              ) : (lots.data ?? []).map((lot) => (
                <button key={lot.lotId} type="button" onClick={() => add(lot)} className="flex w-full flex-col items-start gap-0.5 border-b px-3 py-2 text-left hover:bg-muted/50 last:border-b-0">
                  <span className="font-medium">{lot.variantName ?? lot.sku}</span>
                  <span className="text-xs text-muted-foreground">{t('orva_stock.col.lot', 'ล็อต')} {lot.lotNumber ?? '—'} · {t('orva_stock.col.expiry', 'หมดอายุ')} {lot.expiresAt ?? '—'} · {t('orva_stock.col.onHand', 'คงเหลือ')} {Number(lot.onHand)}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-3 lg:col-span-3">
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="px-3 py-2">{t('orva_stock.col.product', 'สินค้า')}</th>
                    <th className="px-3 py-2 w-24">{t('orva_stock.retail.qty', 'จำนวน')}</th>
                    <th className="px-3 py-2 w-32">{t('orva_stock.retail.price', 'ราคา/ชิ้น (รวม VAT)')}</th>
                    <th className="px-3 py-2 text-right">{t('orva_stock.retail.lineTotal', 'รวม')}</th>
                    <th className="px-3 py-2 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {cart.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">{t('orva_stock.retail.emptyCart', 'คลิกล็อตทางซ้ายเพื่อเพิ่มรายการ')}</td></tr>
                  ) : cart.map((l) => (
                    <tr key={l.lot.lotId} className="border-b last:border-b-0">
                      <td className="px-3 py-2">{l.lot.variantName ?? l.lot.sku}<div className="text-xs text-muted-foreground">{t('orva_stock.col.lot', 'ล็อต')} {l.lot.lotNumber ?? '—'} · {t('orva_stock.col.onHand', 'คงเหลือ')} {Number(l.lot.onHand)}</div></td>
                      <td className="px-3 py-2"><Input type="number" min="1" max={Number(l.lot.onHand)} value={l.quantity} onChange={(e) => update(l.lot.lotId, { quantity: Number(e.target.value) })} /></td>
                      <td className="px-3 py-2"><Input type="number" min="0" step="1" value={l.unitPriceGross || ''} onChange={(e) => update(l.lot.lotId, { unitPriceGross: Number(e.target.value) })} /></td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(l.quantity * l.unitPriceGross)}</td>
                      <td className="px-3 py-2"><button type="button" className="text-xs text-muted-foreground hover:text-destructive" onClick={() => remove(l.lot.lotId)}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
                {cart.length ? (
                  <tfoot>
                    <tr className="border-t"><td colSpan={3} className="px-3 py-2 text-right text-muted-foreground">{t('orva_stock.retail.vatIncluded', 'ภาษีมูลค่าเพิ่มที่รวมอยู่ 7%')}</td><td className="px-3 py-2 text-right tabular-nums">{fmt(vat)}</td><td /></tr>
                    <tr><td colSpan={3} className="px-3 py-2 text-right font-semibold">{t('orva_stock.retail.total', 'ยอดรับเงิน')}</td><td className="px-3 py-2 text-right font-semibold tabular-nums">{fmt(gross)}</td><td /></tr>
                  </tfoot>
                ) : null}
              </table>
            </div>

            <div className="grid gap-3 rounded-md border p-4 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm"><span>{t('orva_stock.retail.customer', 'ชื่อลูกค้า (ไม่บังคับ)')}</span><Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder={t('orva_documents.field.retailCustomer', 'ลูกค้าทั่วไป')} /></label>
              <label className="flex flex-col gap-1 text-sm"><span>{t('orva_stock.retail.phone', 'เบอร์โทร (ไม่บังคับ)')}</span><Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} /></label>
              <label className="flex flex-col gap-1 text-sm"><span>{t('orva_stock.retail.payment', 'รับเงินทาง')}</span>
                <select className="rounded-md border bg-background px-3 py-2" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}>
                  <option value="transfer">{t('orva_stock.retail.payment.transfer', 'โอน / พร้อมเพย์')}</option>
                  <option value="cash">{t('orva_stock.retail.payment.cash', 'เงินสด')}</option>
                  <option value="marketplace">{t('orva_stock.retail.payment.marketplace', 'มาร์เก็ตเพลส (Shopee/Lazada/TikTok)')}</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm"><span>{t('orva_stock.retail.reference', 'อ้างอิง (เลขสลิป / เลขคำสั่งซื้อ)')}</span><Input value={reference} onChange={(e) => setReference(e.target.value)} /></label>
              <label className="flex flex-col gap-1 text-sm"><span>{t('orva_stock.retail.date', 'วันที่ขาย')}</span><Input type="date" value={soldOn} onChange={(e) => setSoldOn(e.target.value)} /></label>
              <label className="flex flex-col gap-1 text-sm"><span>{t('orva_stock.retail.brand', 'แบรนด์ / ซีรีส์เลขที่')}</span>
                <select className="rounded-md border bg-background px-3 py-2" value={brand} onChange={(e) => setBrand(e.target.value)}>
                  {(brands.data ?? []).map((b) => <option key={b.code} value={b.code}>{b.code} · {b.name}</option>)}
                  {!(brands.data ?? []).some((b) => b.code === brand) ? <option value={brand}>{brand}</option> : null}
                </select>
              </label>
              <div className="md:col-span-2">
                <Button onClick={submit} disabled={saving || cart.length === 0}>{t('orva_stock.retail.submit', 'บันทึกการขายและออกใบกำกับภาษีอย่างย่อ')}</Button>
              </div>
            </div>

            {result ? (
              <div className="rounded-md border border-primary p-4 text-sm">
                <div className="font-semibold">{result.invoiceNumber} · {fmt(result.gross)} {t('orva_stock.retail.baht', 'บาท')}</div>
                <div className="text-xs text-muted-foreground">{t('orva_stock.retail.split', 'ก่อน VAT {net} · VAT {vat}').replace('{net}', fmt(result.net)).replace('{vat}', fmt(result.vat))}</div>
                <div className="mt-2 flex gap-3">
                  <Link className="text-primary hover:underline" href={result.documents.abbreviatedTaxInvoice}>{t('orva_documents.type.abbreviated_tax_invoice', 'ใบกำกับภาษีอย่างย่อ')}</Link>
                  <Link className="text-primary hover:underline" href={result.documents.receipt}>{t('orva_documents.type.receipt', 'ใบกำกับภาษี/ใบเสร็จรับเงิน')}</Link>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </PageBody>
    </Page>
  )
}
