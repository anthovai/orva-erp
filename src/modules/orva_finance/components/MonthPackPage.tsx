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

type Plan = {
  month: string
  from: string
  to: string
  fileName: string
  companyName: string | null
  figures: {
    vatOutput: number; vatInput: number; vatNet: number; whtPayable: number; whtReceivable: number
    income: number; expense: number; netProfit: number; cashClosing: number
    journalCount: number; taxDocumentCount: number; bankUnmatched: number
  }
  checklist: { draftJournals: number; unpostedInvoices: number; unmatchedBankLines: number; periodStatus: 'open' | 'closed' | 'missing' }
  files: string[]
  taxDocuments: Array<{ id: string; invoice_number: string; paid_date: string; customer_name: string | null; total: string }>
  accountant: { email: string | null; name: string | null }
  history: Array<{ id: string; month: string; status: string; file_name: string; file_size: number; sent_to: string | null; sent_at: string | null; created_at: string }>
}

type GlSettingsResponse = { retainedEarningsAccountId: string | null; accountantEmail: string | null; accountantName: string | null }

const fmt = (v: number | string) => Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const previousMonth = () => {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - 1)
  return d.toISOString().slice(0, 7)
}
const kb = (bytes: number) => bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

/**
 * ชุดปิดเดือน — the monthly hand-off to the accounting firm: check what is
 * still loose, see the figures the pack will carry, download the zip or send
 * it straight to the accountant on file.
 */
export default function MonthPackPage() {
  const t = useT()
  const qc = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [month, setMonth] = React.useState(previousMonth())
  const [to, setTo] = React.useState('')
  const [name, setName] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [includePdf, setIncludePdf] = React.useState(true)
  const [sending, setSending] = React.useState(false)
  const [savingAccountant, setSavingAccountant] = React.useState(false)
  const validMonth = /^\d{4}-\d{2}$/.test(month)

  const { data, isLoading, error } = useQuery({
    queryKey: ['orva_finance.month-pack', month, scopeVersion],
    queryFn: async () => readApiResultOrThrow<Plan>(`/api/orva_finance/reports/month-pack?month=${month}`),
    enabled: validMonth,
  })
  const settings = useQuery({
    queryKey: ['orva_finance.gl.settings', scopeVersion],
    queryFn: async () => readApiResultOrThrow<GlSettingsResponse>('/api/orva_finance/gl/settings'),
  })
  React.useEffect(() => {
    if (settings.data) {
      setTo(settings.data.accountantEmail ?? '')
      setName(settings.data.accountantName ?? '')
    }
  }, [settings.data])

  const saveAccountant = async () => {
    if (!settings.data?.retainedEarningsAccountId) {
      flash(t('orva_finance.monthPack.accountant.needsGl', 'ตั้งค่าบัญชีกำไรสะสมในตั้งค่า GL ก่อน จึงบันทึกอีเมลสำนักงานบัญชีได้'), 'error')
      return
    }
    setSavingAccountant(true)
    try {
      const res = await apiCall('/api/orva_finance/gl/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ retainedEarningsAccountId: settings.data.retainedEarningsAccountId, accountantEmail: to || null, accountantName: name || null }),
      })
      if (!res.ok) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'save failed')
      flash(t('orva_finance.monthPack.accountant.saved', 'บันทึกที่อยู่สำนักงานบัญชีแล้ว'), 'success')
      await qc.invalidateQueries({ queryKey: ['orva_finance.gl.settings'] })
      await qc.invalidateQueries({ queryKey: ['orva_finance.month-pack'] })
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSavingAccountant(false)
    }
  }

  const send = async () => {
    if (!to) {
      flash(t('orva_finance.monthPack.send.noAddress', 'ใส่อีเมลสำนักงานบัญชีก่อน'), 'error')
      return
    }
    if (!window.confirm(t('orva_finance.monthPack.send.confirm', 'ส่งชุดปิดเดือน {month} ไปที่ {to}?').replace('{month}', month).replace('{to}', to))) return
    setSending(true)
    try {
      const res = await apiCall<{ ok: true; fileSize: number; pdfCount: number; delivered: boolean }>('/api/orva_finance/reports/month-pack/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ month, to, message: message || undefined, includePdf }),
      })
      if (!res.ok || !res.result) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'send failed')
      flash(
        res.result.delivered
          ? t('orva_finance.monthPack.send.done', 'ส่งแล้ว {size} · PDF {count} ไฟล์').replace('{size}', kb(res.result.fileSize)).replace('{count}', String(res.result.pdfCount))
          : t('orva_finance.monthPack.send.captured', 'สร้างชุดแล้ว แต่ระบบอีเมลถูกปิดอยู่ (บันทึกประวัติไว้)'),
        'success',
      )
      setMessage('')
      await qc.invalidateQueries({ queryKey: ['orva_finance.month-pack'] })
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSending(false)
    }
  }

  const checklistItems = data ? [
    { key: 'period', ok: data.checklist.periodStatus === 'closed', label: data.checklist.periodStatus === 'closed' ? t('orva_finance.monthPack.check.periodClosed', 'งวดบัญชีปิดแล้ว') : data.checklist.periodStatus === 'open' ? t('orva_finance.monthPack.check.periodOpen', 'งวดบัญชียังเปิดอยู่ — ตัวเลขยังเปลี่ยนได้') : t('orva_finance.monthPack.check.periodMissing', 'ยังไม่ได้สร้างงวดบัญชีเดือนนี้'), href: '/backend/gl/periods' },
    { key: 'drafts', ok: data.checklist.draftJournals === 0, label: t('orva_finance.monthPack.check.drafts', 'สมุดรายวันฉบับร่าง {count} ฉบับ').replace('{count}', String(data.checklist.draftJournals)), href: '/backend/gl/journals' },
    { key: 'unposted', ok: data.checklist.unpostedInvoices === 0, label: t('orva_finance.monthPack.check.unposted', 'ใบแจ้งหนี้ยังไม่ลงบัญชี {count} ใบ').replace('{count}', String(data.checklist.unpostedInvoices)), href: '/backend/ar/posting' },
    { key: 'bank', ok: data.checklist.unmatchedBankLines === 0, label: t('orva_finance.monthPack.check.bank', 'รายการธนาคารยังไม่กระทบยอด {count} รายการ').replace('{count}', String(data.checklist.unmatchedBankLines)), href: '/backend/bank/reconciliation' },
  ] : []
  const ready = checklistItems.every((c) => c.ok)

  return (
    <Page>
      <PageHeader
        title={t('orva_finance.monthPack.page.title', 'ชุดปิดเดือนส่งสำนักงานบัญชี')}
        description={t('orva_finance.monthPack.page.description', 'รายงานภาษี สมุดบัญชี งบการเงิน และ PDF เอกสารภาษีของเดือน รวมเป็นไฟล์เดียว')}
        actions={(
          <div className="flex items-center gap-2">
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" aria-label={t('orva_finance.monthPack.month', 'เดือน')} />
            <Button asChild variant="outline" disabled={!data}>
              <a href={`/api/orva_finance/reports/month-pack/download?month=${month}&pdf=${includePdf ? '1' : '0'}`} download>
                {t('orva_finance.monthPack.download', 'ดาวน์โหลด zip')}
              </a>
            </Button>
            <Button onClick={send} disabled={!data || sending}>
              {sending ? t('orva_finance.monthPack.sending', 'กำลังส่ง…') : t('orva_finance.monthPack.send', 'ส่งให้สำนักงานบัญชี')}
            </Button>
          </div>
        )}
      />
      <PageBody>
        {error ? <div className="text-sm text-destructive">{String(error)}</div> : null}
        {isLoading ? <div className="py-8 text-center text-sm text-muted-foreground">…</div> : null}
        {data ? (
          <div className="grid gap-6 lg:grid-cols-3">
            <section className="rounded-md border p-4 lg:col-span-1">
              <h2 className="mb-3 text-base font-semibold">{t('orva_finance.monthPack.check.title', 'ก่อนส่ง')}</h2>
              <ul className="flex flex-col gap-2 text-sm">
                {checklistItems.map((c) => (
                  <li key={c.key} className="flex items-start gap-2">
                    <span aria-hidden className={c.ok ? 'text-status-success-text' : 'text-status-warning-text'}>{c.ok ? '✓' : '!'}</span>
                    <Link href={c.href} className="hover:underline">{c.label}</Link>
                  </li>
                ))}
              </ul>
              <p className={`mt-3 text-xs ${ready ? 'text-status-success-text' : 'text-muted-foreground'}`}>
                {ready ? t('orva_finance.monthPack.check.ready', 'พร้อมส่ง') : t('orva_finance.monthPack.check.notReady', 'ส่งได้ แต่หมายเหตุใน 00-สรุปเดือน.txt จะบอกสำนักงานบัญชีว่ายังมีอะไรค้าง')}
              </p>
            </section>

            <section className="rounded-md border p-4 lg:col-span-2">
              <h2 className="mb-3 text-base font-semibold">{t('orva_finance.monthPack.figures.title', 'ตัวเลขในชุดนี้')} — {data.from} → {data.to}</h2>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <Figure label={t('orva_finance.monthPack.figures.vatOutput', 'ภาษีขาย')} value={fmt(data.figures.vatOutput)} />
                <Figure label={t('orva_finance.monthPack.figures.vatInput', 'ภาษีซื้อ')} value={fmt(data.figures.vatInput)} />
                <Figure label={data.figures.vatNet >= 0 ? t('orva_finance.monthPack.figures.vatPayable', 'ภ.พ.30 ต้องชำระ') : t('orva_finance.monthPack.figures.vatCredit', 'ภ.พ.30 ชำระเกิน (ยกไป)')} value={fmt(Math.abs(data.figures.vatNet))} strong />
                <Figure label={t('orva_finance.monthPack.figures.whtPayable', 'ภ.ง.ด.3/53 ต้องนำส่ง')} value={fmt(data.figures.whtPayable)} strong />
                <Figure label={t('orva_finance.monthPack.figures.whtReceivable', 'ถูกหัก ณ ที่จ่าย (เครดิตภาษี)')} value={fmt(data.figures.whtReceivable)} />
                <Figure label={t('orva_finance.monthPack.figures.income', 'รายได้')} value={fmt(data.figures.income)} />
                <Figure label={t('orva_finance.monthPack.figures.expense', 'ค่าใช้จ่าย')} value={fmt(data.figures.expense)} />
                <Figure label={t('orva_finance.monthPack.figures.netProfit', 'กำไร (ขาดทุน) สุทธิ')} value={fmt(data.figures.netProfit)} strong />
                <Figure label={t('orva_finance.monthPack.figures.cash', 'เงินสดปลายเดือน')} value={fmt(data.figures.cashClosing)} />
                <Figure label={t('orva_finance.monthPack.figures.journals', 'สมุดรายวันที่ผ่านรายการ')} value={String(data.figures.journalCount)} />
              </dl>
              <h3 className="mt-4 mb-1 text-sm font-semibold">{t('orva_finance.monthPack.documents.title', 'เอกสารภาษีที่จะแนบ ({count} ชุด)').replace('{count}', String(data.taxDocuments.length))}</h3>
              {data.taxDocuments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('orva_finance.monthPack.documents.empty', 'ไม่มีใบกำกับภาษี/ใบเสร็จออกในเดือนนี้')}</p>
              ) : (
                <ul className="text-sm">
                  {data.taxDocuments.map((d) => (
                    <li key={d.id} className="flex justify-between gap-3 border-b py-1 last:border-b-0">
                      <span>{d.paid_date} · <Link href={`/backend/sales/invoices/${d.id}`} className="font-medium hover:underline">{d.invoice_number}</Link> · {d.customer_name ?? '—'}</span>
                      <span className="tabular-nums">{fmt(d.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={includePdf} onChange={(e) => setIncludePdf(e.target.checked)} />
                {t('orva_finance.monthPack.includePdf', 'แนบ PDF ใบกำกับภาษีและใบเสร็จรับเงิน')}
              </label>
              <details className="mt-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer">{t('orva_finance.monthPack.files', 'ไฟล์ในชุด ({count})').replace('{count}', String(data.files.length + 1))}</summary>
                <ul className="mt-1 list-inside list-disc">
                  <li>00-สรุปเดือน.txt</li>
                  {data.files.map((f) => <li key={f}>{f}</li>)}
                </ul>
              </details>
            </section>

            <section className="rounded-md border p-4 lg:col-span-1">
              <h2 className="mb-3 text-base font-semibold">{t('orva_finance.monthPack.accountant.title', 'สำนักงานบัญชี')}</h2>
              <div className="flex flex-col gap-2">
                <label className="text-xs text-muted-foreground" htmlFor="accountant-name">{t('orva_finance.monthPack.accountant.name', 'ชื่อ')}</label>
                <Input id="accountant-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('orva_finance.monthPack.accountant.namePlaceholder', 'เช่น สำนักงานบัญชี ABC')} />
                <label className="text-xs text-muted-foreground" htmlFor="accountant-email">{t('orva_finance.monthPack.accountant.email', 'อีเมล')}</label>
                <Input id="accountant-email" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="accounting@example.co.th" />
                <label className="text-xs text-muted-foreground" htmlFor="pack-message">{t('orva_finance.monthPack.message', 'ข้อความเพิ่มเติมในอีเมล (ไม่บังคับ)')}</label>
                <textarea id="pack-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className="rounded-md border bg-background px-3 py-2 text-sm" />
                <Button variant="outline" size="sm" onClick={saveAccountant} disabled={savingAccountant}>
                  {t('orva_finance.monthPack.accountant.save', 'บันทึกเป็นค่าเริ่มต้น')}
                </Button>
              </div>
            </section>

            <section className="rounded-md border p-4 lg:col-span-2">
              <h2 className="mb-3 text-base font-semibold">{t('orva_finance.monthPack.history.title', 'ประวัติเดือนนี้')}</h2>
              {data.history.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('orva_finance.monthPack.history.empty', 'ยังไม่เคยสร้างหรือส่งชุดของเดือนนี้')}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-1 pr-3">{t('orva_finance.monthPack.history.when', 'เมื่อ')}</th>
                      <th className="py-1 pr-3">{t('orva_finance.monthPack.history.status', 'สถานะ')}</th>
                      <th className="py-1 pr-3">{t('orva_finance.monthPack.history.to', 'ส่งถึง')}</th>
                      <th className="py-1 text-right">{t('orva_finance.monthPack.history.size', 'ขนาด')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.history.map((h) => (
                      <tr key={h.id} className="border-b last:border-b-0">
                        <td className="py-1 pr-3">{(h.sent_at ?? h.created_at).slice(0, 16).replace('T', ' ')}</td>
                        <td className="py-1 pr-3">{h.status === 'sent' ? t('orva_finance.monthPack.history.sent', 'ส่งแล้ว') : h.status === 'failed' ? t('orva_finance.monthPack.history.failed', 'ส่งไม่สำเร็จ') : t('orva_finance.monthPack.history.generated', 'ดาวน์โหลด')}</td>
                        <td className="py-1 pr-3">{h.sent_to ?? '—'}</td>
                        <td className="py-1 text-right tabular-nums">{kb(h.file_size)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        ) : null}
      </PageBody>
    </Page>
  )
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`tabular-nums ${strong ? 'font-semibold' : ''}`}>{value}</dd>
    </div>
  )
}
