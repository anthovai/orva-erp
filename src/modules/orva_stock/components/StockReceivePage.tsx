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
import { VariantPicker, type Variant } from './VariantPicker'

type Bill = { id: string; bill_no: string; bill_date: string; total_amount: string; vendor_bill_ref: string | null }
type BillLine = { id: string; line_no: number; description: string | null; amount: string }

const today = () => new Date().toISOString().slice(0, 10)
const fmt = (v: number | string) => Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * รับสินค้าเข้าคลัง — a lot arrives from the OEM: pick the bill line it was
 * bought on (cost per unit = line amount ÷ quantity), the product variant,
 * lot number and expiry. WMS keeps the quantity; the cost stays with the lot.
 */
export default function StockReceivePage() {
  const t = useT()
  const qc = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [billId, setBillId] = React.useState('')
  const [billLineId, setBillLineId] = React.useState('')
  const [variant, setVariant] = React.useState<Variant | null>(null)
  const [quantity, setQuantity] = React.useState('')
  const [unitCost, setUnitCost] = React.useState('')
  const [lotNumber, setLotNumber] = React.useState('')
  const [manufacturedOn, setManufacturedOn] = React.useState('')
  const [expiresOn, setExpiresOn] = React.useState('')
  const [receivedOn, setReceivedOn] = React.useState(today())
  const [saving, setSaving] = React.useState(false)
  const [last, setLast] = React.useState<{ lotNumber: string; quantity: string; unitCost: string } | null>(null)

  const bills = useQuery({
    queryKey: ['orva_finance.bills.posted', scopeVersion],
    queryFn: async () => (await readApiResultOrThrow<{ items: Bill[] }>('/api/orva_finance/ap/bills?status=posted&pageSize=50&sortField=bill_date&sortDir=desc')).items,
  })
  const billLines = useQuery({
    queryKey: ['orva_finance.bill.lines', billId, scopeVersion],
    queryFn: async () => (await readApiResultOrThrow<{ lines: BillLine[] }>(`/api/orva_stock/bill-lines?billId=${billId}`)).lines ?? [],
    enabled: Boolean(billId),
  })

  const selectedLine = billLines.data?.find((l) => l.id === billLineId)
  const derivedCost = selectedLine && Number(quantity) > 0 ? Number(selectedLine.amount) / Number(quantity) : null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!variant) { flash(t('orva_stock.receive.pickVariant', 'เลือกสินค้าก่อน'), 'error'); return }
    setSaving(true)
    try {
      const body = {
        catalogVariantId: variant.id,
        quantity: Number(quantity),
        unitCost: unitCost ? Number(unitCost) : undefined,
        billId: billId || null,
        billLineId: billLineId || null,
        lotNumber: lotNumber.trim(),
        manufacturedOn: manufacturedOn || null,
        expiresOn: expiresOn || null,
        receivedOn,
      }
      const res = await apiCall<{ ok: true; lotId: string; unitCost: string; quantity: string }>('/api/orva_stock/receive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok || !res.result) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'failed')
      setLast({ lotNumber: lotNumber.trim(), quantity: res.result.quantity, unitCost: res.result.unitCost })
      flash(t('orva_stock.receive.done', 'รับเข้าคลังแล้ว ล็อต {lot} จำนวน {qty} ต้นทุน {cost}/หน่วย').replace('{lot}', lotNumber.trim()).replace('{qty}', fmt(res.result.quantity)).replace('{cost}', fmt(res.result.unitCost)), 'success')
      setQuantity(''); setUnitCost(''); setLotNumber(''); setExpiresOn(''); setManufacturedOn('')
      await qc.invalidateQueries({ queryKey: ['orva_stock.valuation'] })
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Page>
      <PageHeader
        title={t('orva_stock.receive.page.title', 'รับสินค้าเข้าคลัง')}
        description={t('orva_stock.receive.page.description', 'รับล็อตจาก OEM เข้าคลังพร้อมต้นทุนจากบิลผู้ขาย — จำนวนไปอยู่ที่ WMS ต้นทุนติดไปกับล็อต')}
        actions={<Button asChild variant="outline"><Link href="/backend/stock/valuation">{t('orva_stock.nav.valuation', 'สินค้าคงเหลือ')}</Link></Button>}
      />
      <PageBody>
        <form onSubmit={submit} className="grid max-w-3xl gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            <span>{t('orva_stock.receive.bill', 'บิลผู้ขายที่ซื้อมา (ไม่บังคับ)')}</span>
            <select className="rounded-md border bg-background px-3 py-2" value={billId} onChange={(e) => { setBillId(e.target.value); setBillLineId('') }}>
              <option value="">{t('orva_stock.receive.noBill', 'ไม่อ้างอิงบิล — ใส่ต้นทุนเอง')}</option>
              {(bills.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.bill_no} · {b.bill_date} · {fmt(b.total_amount)}{b.vendor_bill_ref ? ` · ${b.vendor_bill_ref}` : ''}</option>)}
            </select>
          </label>
          {billId ? (
            <label className="flex flex-col gap-1 text-sm md:col-span-2">
              <span>{t('orva_stock.receive.billLine', 'บรรทัดของบิล')}</span>
              <select className="rounded-md border bg-background px-3 py-2" value={billLineId} onChange={(e) => setBillLineId(e.target.value)} required>
                <option value="">—</option>
                {(billLines.data ?? []).map((l) => <option key={l.id} value={l.id}>#{l.line_no} {l.description ?? ''} · {fmt(l.amount)}</option>)}
              </select>
            </label>
          ) : null}
          <div className="flex flex-col gap-1 text-sm md:col-span-2">
            <span>{t('orva_stock.receive.variant', 'สินค้า (variant)')}</span>
            <VariantPicker value={variant} onChange={setVariant} t={t} />
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span>{t('orva_stock.receive.quantity', 'จำนวนที่รับ')}</span>
            <Input type="number" min="0.0001" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>{t('orva_stock.receive.unitCost', 'ต้นทุนต่อหน่วย (ไม่รวม VAT)')}</span>
            <Input type="number" min="0" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder={derivedCost != null ? derivedCost.toFixed(2) : ''} required={!billLineId} />
            {derivedCost != null && !unitCost ? <span className="text-xs text-muted-foreground">{t('orva_stock.receive.derived', 'จากบิล: {amount} ÷ {qty} = {cost}').replace('{amount}', fmt(selectedLine!.amount)).replace('{qty}', quantity).replace('{cost}', fmt(derivedCost))}</span> : null}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>{t('orva_stock.receive.lot', 'เลขล็อต (ตามฉลาก)')}</span>
            <Input value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} required maxLength={120} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>{t('orva_stock.receive.receivedOn', 'วันที่รับเข้า')}</span>
            <Input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} required />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>{t('orva_stock.receive.mfg', 'วันผลิต (MFG)')}</span>
            <Input type="date" value={manufacturedOn} onChange={(e) => setManufacturedOn(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>{t('orva_stock.receive.exp', 'วันหมดอายุ (EXP)')}</span>
            <Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
          </label>
          <div className="md:col-span-2">
            <Button type="submit" disabled={saving}>{t('orva_stock.receive.submit', 'รับเข้าคลัง')}</Button>
          </div>
        </form>
        {last ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {t('orva_stock.receive.last', 'ล่าสุด: ล็อต {lot} · {qty} ชิ้น · ต้นทุน {cost}/หน่วย').replace('{lot}', last.lotNumber).replace('{qty}', fmt(last.quantity)).replace('{cost}', fmt(last.unitCost))}
          </p>
        ) : null}
      </PageBody>
    </Page>
  )
}
