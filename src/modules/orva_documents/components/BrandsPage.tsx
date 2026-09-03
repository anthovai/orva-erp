"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LogoField } from './LogoField'

type Brand = {
  id: string
  code: string
  name: string
  brandColor: string | null
  logoHeader: string | null
  logoFooter: string | null
  logoHeaderQuotation: string | null
  paymentDetails: string | null
  documentTerms: string | null
  quoteNumberFormat: string | null
  invoiceNumberFormat: string | null
  nextQuoteNumber: string | null
  updatedAt: string
}
type BrandsResponse = { items: Brand[]; activeCode: string | null }
type Draft = Omit<Brand, 'id' | 'nextQuoteNumber' | 'updatedAt'> & { id?: string }

const EMPTY: Draft = { code: '', name: '', brandColor: '#11836E', logoHeader: null, logoFooter: null, logoHeaderQuotation: null, paymentDetails: '', documentTerms: '', quoteNumberFormat: '', invoiceNumberFormat: '' }

/**
 * แบรนด์เอกสาร — one legal entity, several brands. The default brand is the
 * document-settings row; each extra brand here gets its own logos, colour,
 * terms and number series. "Create documents with this brand" switches the
 * operator's active brand (cookie) and opens the sales create screen, whose
 * next number then comes from that brand's series.
 */
export default function BrandsPage() {
  const t = useT()
  const qc = useQueryClient()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [saving, setSaving] = React.useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['orva_documents.brands', scopeVersion],
    queryFn: async () => readApiResultOrThrow<BrandsResponse>('/api/orva_documents/brands'),
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['orva_documents.brands'] })

  const activate = async (code: string | null) => {
    const res = await apiCall('/api/orva_documents/brands/activate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })
    if (!res.ok) {
      flash((res.result as { error?: string } | undefined)?.error ?? 'failed', 'error')
      return
    }
    flash(code ? t('orva_documents.brands.activated', 'เปลี่ยนแบรนด์แล้ว เลขที่เอกสารถัดไปจะอยู่ในซีรีส์ {code}').replace('{code}', code) : t('orva_documents.brands.activatedDefault', 'กลับมาใช้แบรนด์หลักแล้ว'), 'success')
    await refresh()
    if (code) router.push('/backend/sales/documents/create')
  }

  const save = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const body = {
        ...draft,
        code: draft.code.trim().toUpperCase(),
        paymentDetails: draft.paymentDetails || null,
        documentTerms: draft.documentTerms || null,
        quoteNumberFormat: draft.quoteNumberFormat || null,
        invoiceNumberFormat: draft.invoiceNumberFormat || null,
        brandColor: draft.brandColor || null,
      }
      const res = await apiCall('/api/orva_documents/brands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'save failed')
      flash(t('orva_documents.brands.saved', 'บันทึกแบรนด์แล้ว'), 'success')
      setDraft(null)
      await refresh()
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (brand: Brand) => {
    if (!window.confirm(t('orva_documents.brands.deleteConfirm', 'ลบแบรนด์ {code}? เอกสารที่ออกไปแล้วยังคงเลขที่เดิม แต่จะพิมพ์ด้วยโลโก้ของแบรนด์หลัก').replace('{code}', brand.code))) return
    const res = await apiCall('/api/orva_documents/brands', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: brand.id }) })
    if (!res.ok) {
      flash((res.result as { error?: string } | undefined)?.error ?? 'failed', 'error')
      return
    }
    flash(t('orva_documents.brands.deleted', 'ลบแบรนด์แล้ว'), 'success')
    await refresh()
  }

  const field = (key: keyof Draft) => (value: string | null) => setDraft((d) => (d ? { ...d, [key]: value } : d))

  return (
    <Page>
      <PageHeader
        title={t('orva_documents.brands.page.title', 'แบรนด์เอกสาร')}
        description={t('orva_documents.brands.page.description', 'นิติบุคคลเดียว หลายแบรนด์ — โลโก้ สี เงื่อนไข และเลขที่เอกสารแยกซีรีส์ต่อแบรนด์ ส่วนชื่อผู้ขาย เลขผู้เสียภาษี และที่อยู่ใช้จากตั้งค่าเอกสาร')}
        actions={<Button onClick={() => setDraft({ ...EMPTY })} disabled={Boolean(draft)}>{t('orva_documents.brands.new', 'เพิ่มแบรนด์')}</Button>}
      />
      <PageBody>
        {error ? <div className="text-sm text-destructive">{String(error)}</div> : null}
        {isLoading ? <div className="py-8 text-center text-sm text-muted-foreground">…</div> : null}
        {data ? (
          <div className="flex flex-col gap-4">
            <section className={`flex flex-wrap items-center justify-between gap-3 rounded-md border p-4 ${data.activeCode ? '' : 'border-primary'}`}>
              <div>
                <h2 className="text-base font-semibold">{t('orva_documents.brands.default.title', 'แบรนด์หลัก (ตั้งค่าเอกสาร)')}</h2>
                <p className="text-xs text-muted-foreground">{t('orva_documents.brands.default.hint', 'เอกสารที่ไม่ได้เลือกแบรนด์ใช้โลโก้และซีรีส์จากตั้งค่าเอกสาร')}</p>
              </div>
              {data.activeCode ? (
                <Button variant="outline" size="sm" onClick={() => activate(null)}>{t('orva_documents.brands.useDefault', 'กลับไปใช้แบรนด์หลัก')}</Button>
              ) : (
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">{t('orva_documents.brands.active', 'กำลังใช้สร้างเอกสาร')}</span>
              )}
            </section>

            {data.items.length === 0 && !draft ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('orva_documents.brands.empty', 'ยังไม่มีแบรนด์เพิ่มเติม — เพิ่ม Marventine ได้ที่นี่เมื่อพร้อมออกเอกสารชุดแรก')}</p>
            ) : null}

            {data.items.map((brand) => (
              <section key={brand.id} className={`flex flex-wrap items-center gap-4 rounded-md border p-4 ${data.activeCode === brand.code ? 'border-primary' : ''}`}>
                <span className="h-10 w-10 shrink-0 rounded" style={{ backgroundColor: brand.brandColor ?? '#11836E' }} aria-hidden />
                {brand.logoHeader ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local data URI
                  <img src={brand.logoHeader} alt="" className="h-10 w-16 object-contain" />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{brand.name}</h3>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{brand.code}</code>
                    {data.activeCode === brand.code ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{t('orva_documents.brands.active', 'กำลังใช้สร้างเอกสาร')}</span> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">{t('orva_documents.brands.next', 'ใบเสนอราคาถัดไป')}: {brand.nextQuoteNumber ?? '—'}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => activate(brand.code)}>{t('orva_documents.brands.use', 'สร้างเอกสารด้วยแบรนด์นี้')}</Button>
                  <Button size="sm" variant="outline" onClick={() => setDraft({ ...brand, paymentDetails: brand.paymentDetails ?? '', documentTerms: brand.documentTerms ?? '', quoteNumberFormat: brand.quoteNumberFormat ?? '', invoiceNumberFormat: brand.invoiceNumberFormat ?? '' })}>{t('orva_documents.brands.edit', 'แก้ไข')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(brand)}>{t('orva_documents.brands.delete', 'ลบแบรนด์')}</Button>
                </div>
              </section>
            ))}

            {draft ? (
              <form
                className="grid gap-4 rounded-md border p-4 md:grid-cols-2"
                onSubmit={(e) => { e.preventDefault(); void save() }}
              >
                <label className="flex flex-col gap-1 text-sm">
                  <span>{t('orva_documents.brands.field.code', 'รหัสซีรีส์ (2–6 ตัว เช่น MRV)')}</span>
                  <Input value={draft.code} onChange={(e) => field('code')(e.target.value.toUpperCase())} maxLength={6} required pattern="[A-Za-z0-9]{2,6}" disabled={Boolean(draft.id)} />
                  <span className="text-xs text-muted-foreground">{t('orva_documents.brands.field.codeHint', 'ขึ้นต้นเลขที่เอกสารทุกใบของแบรนด์ เช่น MRV-QTN-2026001 เปลี่ยนไม่ได้หลังออกเอกสารแล้ว')}</span>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span>{t('orva_documents.brands.field.name', 'ชื่อแบรนด์')}</span>
                  <Input value={draft.name} onChange={(e) => field('name')(e.target.value)} required maxLength={120} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span>{t('orva_documents.brands.field.color', 'สีแบรนด์')}</span>
                  <div className="flex items-center gap-2">
                    <input type="color" value={draft.brandColor ?? '#11836E'} onChange={(e) => field('brandColor')(e.target.value)} className="h-9 w-12 rounded border" />
                    <Input value={draft.brandColor ?? ''} onChange={(e) => field('brandColor')(e.target.value)} pattern="#[0-9a-fA-F]{6}" className="w-32" />
                  </div>
                </label>
                <div className="flex flex-col gap-1 text-sm">
                  <span>{t('orva_documents.brands.field.logoHeader', 'โลโก้หัวเอกสาร')}</span>
                  <LogoField id="brand-logo-header" value={draft.logoHeader} setValue={(v) => field('logoHeader')(typeof v === 'string' ? v : null)} t={t} />
                </div>
                <div className="flex flex-col gap-1 text-sm">
                  <span>{t('orva_documents.brands.field.logoHeaderQuotation', 'โลโก้หัวใบเสนอราคา (ถ้าต่างจากหัวเอกสาร)')}</span>
                  <LogoField id="brand-logo-quotation" value={draft.logoHeaderQuotation} setValue={(v) => field('logoHeaderQuotation')(typeof v === 'string' ? v : null)} t={t} />
                </div>
                <div className="flex flex-col gap-1 text-sm">
                  <span>{t('orva_documents.brands.field.logoFooter', 'โลโก้ท้ายเอกสาร')}</span>
                  <LogoField id="brand-logo-footer" value={draft.logoFooter} setValue={(v) => field('logoFooter')(typeof v === 'string' ? v : null)} darkPreview t={t} />
                </div>
                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span>{t('orva_documents.brands.field.paymentDetails', 'ข้อมูลการชำระเงิน (ว่าง = ใช้ของแบรนด์หลัก)')}</span>
                  <textarea value={draft.paymentDetails ?? ''} onChange={(e) => field('paymentDetails')(e.target.value)} rows={3} className="rounded-md border bg-background px-3 py-2 text-sm" />
                </label>
                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span>{t('orva_documents.brands.field.terms', 'เงื่อนไขท้ายเอกสาร (ว่าง = ใช้ของแบรนด์หลัก)')}</span>
                  <textarea value={draft.documentTerms ?? ''} onChange={(e) => field('documentTerms')(e.target.value)} rows={3} className="rounded-md border bg-background px-3 py-2 text-sm" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span>{t('orva_documents.brands.field.quoteFormat', 'รูปแบบเลขใบเสนอราคา (ว่าง = รูปแบบหลักแทนคำนำหน้าด้วยรหัสแบรนด์)')}</span>
                  <Input value={draft.quoteNumberFormat ?? ''} onChange={(e) => field('quoteNumberFormat')(e.target.value)} placeholder="MRV-QTN-{yyyy}{seq:3}" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span>{t('orva_documents.brands.field.invoiceFormat', 'รูปแบบเลขใบแจ้งหนี้ (ว่าง = รูปแบบหลักแทนคำนำหน้าด้วยรหัสแบรนด์)')}</span>
                  <Input value={draft.invoiceNumberFormat ?? ''} onChange={(e) => field('invoiceNumberFormat')(e.target.value)} placeholder="MRV-INV-{yyyy}{seq:3}" />
                </label>
                <div className="flex gap-2 md:col-span-2">
                  <Button type="submit" disabled={saving}>{t('orva_documents.brands.save', 'บันทึก')}</Button>
                  <Button type="button" variant="outline" onClick={() => setDraft(null)} disabled={saving}>{t('orva_documents.brands.cancel', 'ยกเลิก')}</Button>
                </div>
              </form>
            ) : null}
          </div>
        ) : null}
      </PageBody>
    </Page>
  )
}
