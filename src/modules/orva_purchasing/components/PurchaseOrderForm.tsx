"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody, PageHeader } from '@/components/orva/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Plus, Trash2 } from 'lucide-react'
import { AccountSelect, selectClass, useAccounts, useVendors, VariantSearch, type Variant } from './pickers'

type LineDraft = {
  key: number
  kind: 'goods' | 'service'
  variant: Variant | null
  description: string
  quantity: string
  unit: string
  unitPrice: string
  vatMode: 'none' | '7'
  accountId: string
  expectedOn: string
}

export type PurchaseOrderFormInitial = {
  id: string
  updatedAt: string
  vendorPartyId: string
  orderDate: string
  expectedOn: string | null
  memo: string | null
  vendorReference: string | null
  lines: Array<{
    id: string
    kind: string
    catalogVariantId: string | null
    description: string
    sku: string | null
    quantity: number
    unit: string | null
    unitPrice: number
    vatMode: string
    accountId: string
    expectedOn: string | null
  }>
}

type Settings = {
  vatDefault: string
  defaultGoodsAccountId: string | null
  defaultServiceAccountId: string | null
  nextPoNumber: string
}

const today = () => new Date().toISOString().slice(0, 10)
const money = (value: number) => value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Draft an order, or edit one that has not been sent.
 *
 * Hand-built rather than `CrudForm` for the reason `BillCreateForm` is: this
 * is a header plus a line editor whose rows each carry three references and a
 * per-line VAT mode, and the totals have to move as the operator types.
 * `CrudForm` owns whole-record field layout, not a sub-table with running
 * arithmetic — the surrounding shell, controls and states stay platform
 * primitives.
 *
 * Nothing here can edit a sent order: the page only mounts this component
 * while the order is a draft.
 */
export function PurchaseOrderForm({ initial }: { initial?: PurchaseOrderFormInitial }) {
  const t = useT()
  const router = useRouter()
  const { vendors, isLoading: vendorsLoading, failed: vendorsFailed } = useVendors()
  const { accounts, failed: accountsFailed } = useAccounts()
  const nextKey = React.useRef(1)

  const [settings, setSettings] = React.useState<Settings | null>(null)
  const [vendorPartyId, setVendorPartyId] = React.useState(initial?.vendorPartyId ?? '')
  const [orderDate, setOrderDate] = React.useState(initial?.orderDate ?? today())
  const [expectedOn, setExpectedOn] = React.useState(initial?.expectedOn ?? '')
  const [vendorReference, setVendorReference] = React.useState(initial?.vendorReference ?? '')
  const [memo, setMemo] = React.useState(initial?.memo ?? '')
  const [saving, setSaving] = React.useState(false)
  const [lines, setLines] = React.useState<LineDraft[]>(() =>
    (initial?.lines ?? []).map((line) => ({
      key: nextKey.current++,
      kind: line.kind === 'service' ? 'service' : 'goods',
      variant: line.catalogVariantId
        ? { id: line.catalogVariantId, name: line.description, sku: line.sku, barcode: null }
        : null,
      description: line.description,
      quantity: String(line.quantity),
      unit: line.unit ?? '',
      unitPrice: String(line.unitPrice),
      vatMode: line.vatMode === 'none' ? 'none' : '7',
      accountId: line.accountId,
      expectedOn: line.expectedOn ?? '',
    })),
  )

  React.useEffect(() => {
    let alive = true
    readApiResultOrThrow<Settings>('/api/orva_purchasing/settings')
      .then((value) => {
        if (alive) setSettings(value)
      })
      .catch(() => {
        /* defaults are a convenience; the form works without them */
      })
    return () => {
      alive = false
    }
  }, [])

  const blankLine = React.useCallback(
    (kind: 'goods' | 'service'): LineDraft => ({
      key: nextKey.current++,
      kind,
      variant: null,
      description: '',
      quantity: '1',
      unit: '',
      unitPrice: '',
      vatMode: (settings?.vatDefault === 'none' ? 'none' : '7') as 'none' | '7',
      accountId:
        (kind === 'goods' ? settings?.defaultGoodsAccountId : settings?.defaultServiceAccountId) ?? '',
      expectedOn: '',
    }),
    [settings],
  )

  // A brand-new order opens with one goods line, so the first thing the
  // operator sees is the row they are about to fill in.
  React.useEffect(() => {
    if (!initial && lines.length === 0 && settings) setLines([blankLine('goods')])
  }, [initial, lines.length, settings, blankLine])

  const update = (key: number, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  const remove = (key: number) => setLines((prev) => prev.filter((line) => line.key !== key))

  const measured = lines.map((line) => ({
    net: Math.round(Number(line.quantity || 0) * Number(line.unitPrice || 0) * 100) / 100,
    vatMode: line.vatMode,
  }))
  const subtotal = Math.round(measured.reduce((sum, line) => sum + line.net, 0) * 100) / 100
  const taxAmount =
    Math.round(measured.reduce((sum, line) => sum + (line.vatMode === '7' ? line.net * 0.07 : 0), 0) * 100) / 100

  const submit = async () => {
    if (!vendorPartyId) {
      flash(t('orva_purchasing.form.needVendor', 'เลือกผู้ขายก่อน'), 'error')
      return
    }
    if (lines.length === 0) {
      flash(t('orva_purchasing.form.needLine', 'ใส่รายการอย่างน้อยหนึ่งบรรทัด'), 'error')
      return
    }
    for (const line of lines) {
      const description = line.kind === 'goods' ? (line.variant?.name ?? line.description) : line.description
      if (!description.trim()) {
        flash(t('orva_purchasing.form.needDescription', 'ทุกบรรทัดต้องมีชื่อรายการ'), 'error')
        return
      }
      if (line.kind === 'goods' && !line.variant) {
        flash(t('orva_purchasing.form.needVariant', 'บรรทัดสินค้าต้องเลือกสินค้าจากแค็ตตาล็อก'), 'error')
        return
      }
      if (!line.accountId) {
        flash(t('orva_purchasing.form.needAccount', 'ทุกบรรทัดต้องเลือกบัญชี'), 'error')
        return
      }
      if (!(Number(line.quantity) > 0)) {
        flash(t('orva_purchasing.form.needQuantity', 'จำนวนต้องมากกว่า 0'), 'error')
        return
      }
    }

    const payload = {
      vendorPartyId,
      orderDate,
      expectedOn: expectedOn || null,
      memo: memo || null,
      vendorReference: vendorReference || null,
      lines: lines.map((line) => ({
        kind: line.kind,
        catalogVariantId: line.kind === 'goods' ? (line.variant?.id ?? null) : null,
        description: (line.kind === 'goods' ? (line.variant?.name ?? line.description) : line.description).trim(),
        sku: line.kind === 'goods' ? (line.variant?.sku ?? null) : null,
        quantity: Number(line.quantity),
        unit: line.unit || null,
        unitPrice: Number(line.unitPrice || 0),
        vatMode: line.vatMode,
        accountId: line.accountId,
        expectedOn: line.expectedOn || null,
      })),
    }

    setSaving(true)
    try {
      if (initial) {
        const res = await apiCall<{ ok: true; id: string }>('/api/orva_purchasing/orders', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: initial.id, updatedAt: initial.updatedAt, ...payload }),
        })
        if (!res.ok || !res.result) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'failed')
        flash(t('orva_purchasing.form.saved', 'บันทึกใบสั่งซื้อแล้ว'), 'success')
        router.push(`/backend/purchasing/orders/${initial.id}`)
        router.refresh()
      } else {
        const res = await apiCall<{ ok: true; id: string }>('/api/orva_purchasing/orders', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok || !res.result) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'failed')
        flash(t('orva_purchasing.form.created', 'สร้างฉบับร่างแล้ว — ตรวจแล้วกดส่งให้ผู้ขาย'), 'success')
        router.push(`/backend/purchasing/orders/${res.result.id}`)
      }
    } catch (error) {
      // The server's message is the useful one (no vendor role, stale version);
      // the typed input stays on screen so nothing has to be retyped.
      flash(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  const body = (
    <div className="flex flex-col gap-6">
      <section className="grid gap-3 rounded-md border p-4 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('orva_purchasing.field.vendor', 'ผู้ขาย')}</span>
          <select className={selectClass} value={vendorPartyId} onChange={(event) => setVendorPartyId(event.target.value)}>
            <option value="">
              {vendorsLoading
                ? t('orva_purchasing.loading', 'กำลังโหลด…')
                : t('orva_purchasing.field.vendorPick', 'เลือกผู้ขาย')}
            </option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.display_name}
              </option>
            ))}
          </select>
          {vendorsFailed ? (
            // Never advise fixing data when the lookup itself failed: this
            // screen shipped telling operators to add a vendor role they had.
            <span role="alert" className="text-xs text-destructive">
              {t('orva_purchasing.field.vendorsFailed', 'โหลดรายชื่อผู้ขายไม่สำเร็จ — รีเฟรชหน้านี้อีกครั้ง')}
            </span>
          ) : !vendorsLoading && vendors.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              {t('orva_purchasing.field.noVendors', 'ยังไม่มีคู่ค้าที่เป็นผู้ขาย — เพิ่มบทบาท "ผู้ขาย" ในทะเบียนคู่ค้าก่อน')}
            </span>
          ) : null}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('orva_purchasing.field.orderDate', 'วันที่สั่ง')}</span>
          <Input type="date" value={orderDate} onChange={(event) => setOrderDate(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('orva_purchasing.field.expectedOn', 'คาดว่าได้รับ')}</span>
          <Input type="date" value={expectedOn} onChange={(event) => setExpectedOn(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('orva_purchasing.field.vendorReference', 'อ้างอิงของผู้ขาย')}</span>
          <Input value={vendorReference} onChange={(event) => setVendorReference(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm md:col-span-2">
          <span className="font-medium">{t('orva_purchasing.field.memo', 'หมายเหตุ')}</span>
          <Input value={memo} onChange={(event) => setMemo(event.target.value)} />
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t('orva_purchasing.lines.title', 'รายการที่สั่ง')}</h2>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, blankLine('goods')])}>
              <Plus className="size-4" />
              {t('orva_purchasing.lines.addGoods', 'เพิ่มสินค้า')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, blankLine('service')])}>
              <Plus className="size-4" />
              {t('orva_purchasing.lines.addService', 'เพิ่มบริการ')}
            </Button>
          </div>
        </div>

        {lines.length === 0 ? (
          <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {t('orva_purchasing.lines.empty', 'ยังไม่มีรายการ — เพิ่มสินค้าหรือบริการที่จะสั่ง')}
          </p>
        ) : null}

        {lines.map((line, index) => (
          <div key={line.key} className="grid gap-3 rounded-md border p-3 md:grid-cols-12">
            <div className="md:col-span-4">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {line.kind === 'goods'
                  ? t('orva_purchasing.field.item', 'สินค้า')
                  : t('orva_purchasing.field.service', 'บริการ')}
              </span>
              {line.kind === 'goods' ? (
                <VariantSearch
                  value={line.variant}
                  onChange={(variant) =>
                    update(line.key, { variant, description: variant?.name ?? line.description })
                  }
                  t={t}
                />
              ) : (
                <Input
                  value={line.description}
                  onChange={(event) => update(line.key, { description: event.target.value })}
                  placeholder={t('orva_purchasing.field.servicePlaceholder', 'เช่น ค่าขนส่ง, ค่าออกแบบ')}
                />
              )}
            </div>
            <label className="md:col-span-1">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t('orva_purchasing.field.quantity', 'จำนวน')}
              </span>
              <Input
                type="number"
                min="0"
                step="0.0001"
                value={line.quantity}
                onChange={(event) => update(line.key, { quantity: event.target.value })}
              />
            </label>
            <label className="md:col-span-1">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t('orva_purchasing.field.unit', 'หน่วย')}
              </span>
              <Input value={line.unit} onChange={(event) => update(line.key, { unit: event.target.value })} />
            </label>
            <label className="md:col-span-2">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t('orva_purchasing.field.unitPrice', 'ราคา/หน่วย (ก่อน VAT)')}
              </span>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={line.unitPrice}
                onChange={(event) => update(line.key, { unitPrice: event.target.value })}
              />
            </label>
            <label className="md:col-span-1">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t('orva_purchasing.field.vat', 'VAT')}
              </span>
              <select
                className={selectClass}
                value={line.vatMode}
                onChange={(event) => update(line.key, { vatMode: event.target.value as 'none' | '7' })}
              >
                <option value="7">7%</option>
                <option value="none">{t('orva_purchasing.field.vatNone', 'ไม่มี')}</option>
              </select>
            </label>
            <div className="md:col-span-2">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t('orva_purchasing.field.account', 'บัญชี')}
              </span>
              <AccountSelect
                value={line.accountId}
                onChange={(value) => update(line.key, { accountId: value })}
                accounts={accounts}
                placeholder={t('orva_purchasing.field.accountPick', 'เลือกบัญชี')}
              />
              {accountsFailed ? (
                <span role="alert" className="mt-1 block text-xs text-destructive">
                  {t('orva_purchasing.field.accountsFailed', 'โหลดผังบัญชีไม่สำเร็จ — รีเฟรชหน้านี้อีกครั้ง')}
                </span>
              ) : null}
            </div>
            <div className="flex items-end justify-between gap-2 md:col-span-1">
              <span className="text-sm tabular-nums">{money(measured[index].net)}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('orva_purchasing.lines.remove', 'ลบบรรทัด')}
                onClick={() => remove(line.key)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        ))}
      </section>

      <section className="flex flex-wrap items-end justify-between gap-4 rounded-md border p-4">
        <dl className="grid gap-1 text-sm">
          <div className="flex gap-3">
            <dt className="text-muted-foreground">{t('orva_purchasing.totals.subtotal', 'รวมก่อน VAT')}</dt>
            <dd className="tabular-nums">{money(subtotal)}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="text-muted-foreground">{t('orva_purchasing.totals.vat', 'VAT')}</dt>
            <dd className="tabular-nums">{money(taxAmount)}</dd>
          </div>
          <div className="flex gap-3 font-semibold">
            <dt>{t('orva_purchasing.totals.total', 'รวมทั้งสิ้น')}</dt>
            <dd className="tabular-nums">{money(Math.round((subtotal + taxAmount) * 100) / 100)}</dd>
          </div>
        </dl>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => router.back()} disabled={saving}>
            {t('orva_purchasing.cancel', 'ยกเลิก')}
          </Button>
          <Button type="button" onClick={submit} disabled={saving}>
            {saving
              ? t('orva_purchasing.saving', 'กำลังบันทึก…')
              : initial
                ? t('orva_purchasing.form.save', 'บันทึกฉบับร่าง')
                : t('orva_purchasing.form.create', 'สร้างฉบับร่าง')}
          </Button>
        </div>
      </section>
    </div>
  )

  // Edit mode renders inside the detail page, which already has a header.
  if (initial) return body

  return (
    <Page>
      <PageHeader
        title={t('orva_purchasing.create.page.title', 'สร้างใบสั่งซื้อ')}
        description={t(
          'orva_purchasing.create.page.description',
          'ฉบับร่างยังไม่กินเลขที่ — เลขที่ใบสั่งซื้อจะถูกจองเมื่อกดส่งให้ผู้ขาย',
        )}
      />
      <PageBody>{body}</PageBody>
    </Page>
  )
}

export default PurchaseOrderForm
