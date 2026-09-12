"use client"
import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@/components/orva/Page'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { RadioGroup } from '@open-mercato/ui/primitives/radio'
import { RadioField } from '@open-mercato/ui/primitives/radio-field'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { OrvaEmptyState } from '@/components/orva/NodeMark'
import { byType, leafAccounts, useActiveAccounts, useApSettings, useOpenPeriods, type AccountOption } from './queries'
import { computeExpensePosting, suggestedWithholding, type ReceiptKind } from '../lib/expensePosting'

type Expense = {
  journalId: string; journalNo: string | null; paidOn: string; payee: string | null
  documentNo: string | null; memo: string | null; net: string; vat: string; wht: string; paid: string; expenseAccount: string | null
}

type Form = {
  paidOn: string
  payee: string
  expenseAccountId: string
  memo: string
  gross: string
  cashAccountId: string
  kind: ReceiptKind
  payeeTaxId: string
  documentNo: string
  /** VAT as printed on the paper; null = the automatic 7% split */
  vatOverride: string | null
  whtOn: boolean
  whtRate: string
  whtRateOther: string
  /** hand-edited withholding; null = computed */
  whtAmount: string | null
}

const WHT_RATES = ['1', '2', '3', '5'] as const
const LAST_CASH_KEY = 'orva_finance.expense.lastCashAccountId'

const pad = (n: number) => String(n).padStart(2, '0')
const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const fmt = (v: number | string) => Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
}
const emptyForm = (paidOn: string, cashAccountId: string): Form => ({
  paidOn, payee: '', expenseAccountId: '', memo: '', gross: '', cashAccountId,
  kind: 'plain', payeeTaxId: '', documentNo: '', vatOverride: null,
  whtOn: false, whtRate: '3', whtRateOther: '', whtAmount: null,
})

/**
 * ค่าใช้จ่ายจ่ายสด — the one screen for a receipt paid without a vendor bill.
 *
 * The owner is not an accountant, so the form is three questions the paper in
 * hand can answer (ใบเสร็จนี้คืออะไร · จ่ายเท่าไหร่ จ่ายจากไหน · เรื่องภาษี) and
 * the posting the accountant will receive is on screen before the save, not
 * after it. Tax questions stay folded until the receipt is declared a full tax
 * invoice; withholding stays off until the payment is one that withholds.
 * The month list underneath is what goes to the accounting firm.
 *
 * The API and the journal it posts are unchanged: `computeExpensePosting`
 * maps the answers onto the same payload the old twelve-field form sent.
 */
export default function ExpensesPage() {
  const t = useT()
  const qc = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [month, setMonth] = React.useState('')
  const [form, setForm] = React.useState<Form>(() => emptyForm('', ''))
  const [receipt, setReceipt] = React.useState<File | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState<{ journalNo: string; journalId: string; cashOut: number; uploadFailed: boolean } | null>(null)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [touched, setTouched] = React.useState(false)
  const payeeRef = React.useRef<HTMLInputElement>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)

  // Dates and the remembered bank account are decided on the client after
  // mount: the server render must not guess the operator's day or browser.
  React.useEffect(() => {
    const today = localToday()
    let remembered = ''
    try { remembered = window.localStorage.getItem(LAST_CASH_KEY) ?? '' } catch { remembered = '' }
    setMonth(today.slice(0, 7))
    setForm((current) => ({ ...current, paidOn: current.paidOn || today, cashAccountId: current.cashAccountId || remembered }))
  }, [])

  const { accounts, isLoading: accountsLoading, failed: accountsFailed, refetch: refetchAccounts } = useActiveAccounts()
  const postable = React.useMemo(() => leafAccounts(accounts), [accounts])
  const expenseAccounts = React.useMemo(() => byType(postable, 'expense'), [postable])
  const cashAccounts = React.useMemo(() => {
    const assets = byType(postable, 'asset')
    const cashLike = assets.filter((a) => a.code.startsWith('10'))
    return cashLike.length > 0 ? cashLike : assets
  }, [postable])
  const { periods, isLoading: periodsLoading, failed: periodsFailed } = useOpenPeriods()
  const apSettings = useApSettings()

  // One bank account, or exactly one remembered — pick it so the common case is three inputs.
  React.useEffect(() => {
    if (form.cashAccountId || cashAccounts.length === 0) return
    const bank = cashAccounts.find((a) => a.code === '1020') ?? (cashAccounts.length === 1 ? cashAccounts[0] : null)
    if (bank) setForm((current) => (current.cashAccountId ? current : { ...current, cashAccountId: bank.id }))
  }, [cashAccounts, form.cashAccountId])

  const list = useQuery({
    queryKey: ['orva_finance.expenses', month, scopeVersion],
    queryFn: () => readApiResultOrThrow<{ items: Expense[] }>(`/api/orva_finance/expenses?month=${month}`),
    enabled: /^\d{4}-\d{2}$/.test(month),
  })

  const rate = form.whtRate === 'other' ? Number(form.whtRateOther || 0) : Number(form.whtRate)
  const posting = computeExpensePosting({
    gross: Number(form.gross || 0),
    kind: form.kind,
    vatOverride: form.vatOverride === null ? null : Number(form.vatOverride || 0),
    whtOn: form.whtOn,
    whtRate: rate,
    whtAmount: form.whtAmount === null ? null : Number(form.whtAmount || 0),
  })
  const expenseAccount = expenseAccounts.find((a) => a.id === form.expenseAccountId) ?? null
  const cashAccount = cashAccounts.find((a) => a.id === form.cashAccountId) ?? null
  // Only a loaded list can say the month is closed; while it loads, or if the
  // lookup failed, the route's own check on save is the authority.
  const periodOpen = form.paidOn.length !== 10 || periodsLoading || periodsFailed || periods.some((p) => p.code === form.paidOn.slice(0, 7))
  const settingsKnown = apSettings.data !== undefined
  const vatBlocked = form.kind === 'full' && settingsKnown && !apSettings.data?.inputVatAccountId
  const whtBlocked = form.whtOn && settingsKnown && !apSettings.data?.whtPayableAccountId
  const fullNeedsIds = form.kind === 'full' && (!form.payeeTaxId.trim() || !form.documentNo.trim())
  const chartEmpty = !accountsLoading && !accountsFailed && (expenseAccounts.length === 0 || cashAccounts.length === 0)
  const canSubmit =
    !saving && !accountsLoading && !accountsFailed && !chartEmpty && periodOpen && !vatBlocked && !whtBlocked && !fullNeedsIds &&
    posting.errors.length === 0 && form.payee.trim().length > 0 && Boolean(form.expenseAccountId) && Boolean(form.cashAccountId) && form.paidOn.length === 10
  const dirty = touched && (form.payee !== '' || form.gross !== '' || form.expenseAccountId !== '' || form.memo !== '' || receipt !== null)

  const update = (patch: Partial<Form>) => {
    setTouched(true)
    setSaved(null)
    setForm((current) => ({ ...current, ...patch }))
  }

  const clear = React.useCallback(() => {
    setForm((current) => emptyForm(current.paidOn, current.cashAccountId))
    setReceipt(null)
    if (fileRef.current) fileRef.current.value = ''
    setTouched(false)
    setSaveError(null)
    payeeRef.current?.focus()
  }, [])

  const askToClear = async () => {
    if (!dirty) return clear()
    const ok = await confirm({
      title: t('orva_finance.expense.clear.title', 'ล้างที่กรอกไว้ทั้งหมด?'),
      description: t('orva_finance.expense.clear.description', 'รายการนี้ยังไม่ได้บันทึก'),
      confirmText: t('orva_finance.expense.clear.confirm', 'ล้างฟอร์ม'),
      cancelText: t('orva_finance.expense.clear.cancel', 'กรอกต่อ'),
    })
    if (ok) clear()
  }

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await apiCall<{ ok: true; journalId: string; journalNo: string }>('/api/orva_finance/expenses', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          paidOn: form.paidOn, payee: form.payee.trim(),
          payeeTaxId: form.kind === 'full' ? form.payeeTaxId.trim() || null : null,
          documentNo: form.kind === 'full' ? form.documentNo.trim() || null : null,
          expenseAccountId: form.expenseAccountId, cashAccountId: form.cashAccountId,
          ...posting.payload,
          memo: form.memo.trim() || null,
        }),
      })
      if (!res.ok || !res.result) throw new Error((res.result as { error?: string } | undefined)?.error ?? t('orva_finance.expense.failed', 'บันทึกไม่สำเร็จ'))
      // The receipt image rides along after the journal exists — a failed
      // upload must not undo a posted expense.
      let uploadFailed = false
      if (receipt) {
        const fd = new FormData()
        fd.set('entityId', 'orva_finance:gl_journal')
        fd.set('recordId', res.result.journalId)
        fd.set('file', receipt)
        const upload = await apiCall('/api/attachments', { method: 'POST', body: fd })
        uploadFailed = !upload.ok
      }
      try { window.localStorage.setItem(LAST_CASH_KEY, form.cashAccountId) } catch { /* private mode: nothing to remember into */ }
      flash(t('orva_finance.expense.saved', 'บันทึกและลงบัญชีแล้ว {journal}').replace('{journal}', res.result.journalNo), 'success')
      setSaved({ journalNo: res.result.journalNo, journalId: res.result.journalId, cashOut: posting.cashOut, uploadFailed })
      setForm((current) => emptyForm(current.paidOn, current.cashAccountId))
      setReceipt(null)
      if (fileRef.current) fileRef.current.value = ''
      setTouched(false)
      payeeRef.current?.focus()
      await qc.invalidateQueries({ queryKey: ['orva_finance.expenses'] })
      await qc.invalidateQueries({ queryKey: ['orva_finance.journals'] })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void submit() }
    if (e.key === 'Escape' && dirty) { e.preventDefault(); void askToClear() }
  }

  const items = list.data?.items ?? []
  const totals = items.reduce(
    (acc, row) => ({ net: acc.net + Number(row.net), vat: acc.vat + Number(row.vat), wht: acc.wht + Number(row.wht), paid: acc.paid + Number(row.paid) }),
    { net: 0, vat: 0, wht: 0, paid: 0 },
  )

  const accountLabel = (a: AccountOption) => (
    <span className="flex w-full items-center gap-2">
      <span className="truncate">{a.name}</span>
      <span className="ml-auto text-xs tabular-nums text-muted-foreground">{a.code}</span>
    </span>
  )

  return (
    <Page>
      <PageHeader
        title={t('orva_finance.expense.page.title', 'ค่าใช้จ่ายจ่ายสด')}
        description={t('orva_finance.expense.page.description', 'มีใบเสร็จอยู่ในมือ? กรอก 3 ขั้น — ระบบลงบัญชีให้ทันที และส่งเข้ารายงานภาษีซื้อ/หัก ณ ที่จ่ายให้เอง')}
      />
      <PageBody>
        <form onSubmit={submit} onKeyDown={onKeyDown} className="grid gap-6 lg:grid-cols-5" aria-busy={saving}>
          <div className="flex flex-col gap-4 lg:col-span-3">
            {accountsFailed ? (
              <Alert status="error" action={<Button type="button" size="sm" variant="outline" onClick={() => void refetchAccounts()}>{t('orva_finance.expense.retry', 'ลองใหม่')}</Button>}>
                {t('orva_finance.expense.chartFailed', 'โหลดผังบัญชีไม่สำเร็จ — ยังบันทึกไม่ได้')}
              </Alert>
            ) : null}

            {/* ขั้นที่ 1 — read the top of the receipt */}
            <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
              <div>
                <p className="orva-kicker">{t('orva_finance.expense.step1.kicker', 'ขั้นที่ 1')}</p>
                <h2 className="text-base font-semibold">{t('orva_finance.expense.step1.title', 'ใบเสร็จนี้คืออะไร')}</h2>
                <p className="text-sm text-muted-foreground">{t('orva_finance.expense.step1.hint', 'ดูหัวใบเสร็จ: ชื่อร้านหรือบริษัท และวันที่')}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label={t('orva_finance.expense.payee', 'จ่ายให้ใคร')} required>
                  <Input ref={payeeRef} autoFocus value={form.payee} onChange={(e) => update({ payee: e.target.value })} maxLength={200} placeholder={t('orva_finance.expense.payeePlaceholder', 'เช่น ร้านกาแฟ / บริษัท เอ จำกัด')} />
                </FormField>
                <FormField label={t('orva_finance.expense.paidOn', 'วันที่บนใบเสร็จ')} required
                  error={form.paidOn.length === 10 && !periodOpen ? t('orva_finance.expense.periodClosed', 'ยังไม่มีงวดบัญชี {month} ที่เปิดอยู่').replace('{month}', form.paidOn.slice(0, 7)) : undefined}>
                  <Input type="date" value={form.paidOn} onChange={(e) => update({ paidOn: e.target.value })} required />
                </FormField>
              </div>
              {form.paidOn.length === 10 && !periodOpen ? (
                <Alert status="warning" action={<Button asChild size="sm" variant="outline"><Link href="/backend/gl/periods">{t('orva_finance.expense.openPeriod', 'ไปเปิดงวดบัญชี')}</Link></Button>}>
                  {t('orva_finance.expense.periodClosedHelp', 'ระบบลงบัญชีได้เฉพาะเดือนที่เปิดงวดไว้ — เปิดงวดของเดือนนี้ก่อน แล้วกลับมาบันทึก')}
                </Alert>
              ) : null}
              <FormField label={t('orva_finance.expense.category', 'เป็นค่าอะไร')} required description={t('orva_finance.expense.categoryHelp', 'เลือกหมวดที่ใกล้ที่สุด สำนักงานบัญชีปรับได้ทีหลัง')}>
                {accountsLoading ? <Skeleton className="h-9 w-full" /> : (
                  <Select value={form.expenseAccountId || undefined} onValueChange={(value) => update({ expenseAccountId: value })} disabled={expenseAccounts.length === 0}>
                    <SelectTrigger><SelectValue placeholder={t('orva_finance.expense.categoryPlaceholder', 'เลือกหมวดค่าใช้จ่าย')} /></SelectTrigger>
                    <SelectContent>
                      {expenseAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{accountLabel(a)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
              {!accountsLoading && !accountsFailed && expenseAccounts.length === 0 ? (
                <Alert status="warning" action={<Button asChild size="sm" variant="outline"><Link href="/backend/gl/accounts/create">{t('orva_finance.expense.createAccount', 'สร้างในผังบัญชี')}</Link></Button>}>
                  {t('orva_finance.expense.noExpenseAccounts', 'ผังบัญชียังไม่มีหมวดค่าใช้จ่าย (ประเภท expense)')}
                </Alert>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label={t('orva_finance.expense.memo', 'ซื้ออะไร / ใช้ทำอะไร (ไม่บังคับ)')}>
                  <Input value={form.memo} onChange={(e) => update({ memo: e.target.value })} maxLength={500} placeholder={t('orva_finance.expense.memoPlaceholder', 'เช่น หมึกพิมพ์สำหรับออฟฟิศ')} />
                </FormField>
                <FormField label={t('orva_finance.expense.receipt', 'รูปใบเสร็จ (ไม่บังคับ)')} description={t('orva_finance.expense.receiptHelp', 'แนบไว้กับรายการ สำนักงานบัญชีเปิดดูได้เอง')}>
                  <input ref={fileRef} type="file" accept="image/*,application/pdf" className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground" onChange={(e) => { setTouched(true); setReceipt(e.target.files?.[0] ?? null) }} />
                </FormField>
              </div>
            </section>

            {/* ขั้นที่ 2 — the biggest number on the receipt */}
            <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
              <div>
                <p className="orva-kicker">{t('orva_finance.expense.step2.kicker', 'ขั้นที่ 2')}</p>
                <h2 className="text-base font-semibold">{t('orva_finance.expense.step2.title', 'จ่ายเท่าไหร่ จ่ายจากไหน')}</h2>
                <p className="text-sm text-muted-foreground">{t('orva_finance.expense.step2.hint', 'ดูบรรทัด "รวมทั้งสิ้น" — ตัวเลขที่ใหญ่ที่สุดบนใบ')}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label={t('orva_finance.expense.amount', 'ยอดรวมทั้งสิ้นที่จ่าย (บาท)')} required
                  description={t('orva_finance.expense.amountHelp', 'รวม VAT แล้วถ้ามี')}
                  error={touched && form.gross !== '' && posting.errors.includes('gross') ? t('orva_finance.expense.amountError', 'กรอกยอดเงินมากกว่า 0') : undefined}>
                  <Input type="number" inputMode="decimal" min="0.01" step="0.01" value={form.gross} onChange={(e) => update({ gross: e.target.value })} className="text-right text-lg tabular-nums" required />
                </FormField>
                <FormField label={t('orva_finance.expense.paidFrom', 'จ่ายจาก')} required description={t('orva_finance.expense.paidFromHelp', 'เงินสดในกระเป๋า = เงินสดย่อย · โอน/ตัดบัตร = ธนาคาร')}>
                  {accountsLoading ? <Skeleton className="h-9 w-full" /> : cashAccounts.length > 0 && cashAccounts.length <= 3 ? (
                    <SegmentedControl value={form.cashAccountId} onValueChange={(value) => update({ cashAccountId: value })} className="w-full">
                      {cashAccounts.map((a) => <SegmentedControlItem key={a.id} value={a.id} className="flex-1">{a.name}</SegmentedControlItem>)}
                    </SegmentedControl>
                  ) : (
                    <Select value={form.cashAccountId || undefined} onValueChange={(value) => update({ cashAccountId: value })} disabled={cashAccounts.length === 0}>
                      <SelectTrigger><SelectValue placeholder={t('orva_finance.expense.paidFromPlaceholder', 'เลือกบัญชีเงินสด/ธนาคาร')} /></SelectTrigger>
                      <SelectContent>
                        {cashAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{accountLabel(a)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
              </div>
              {!accountsLoading && !accountsFailed && cashAccounts.length === 0 ? (
                <Alert status="warning" action={<Button asChild size="sm" variant="outline"><Link href="/backend/gl/accounts/create">{t('orva_finance.expense.createAccount', 'สร้างในผังบัญชี')}</Link></Button>}>
                  {t('orva_finance.expense.noCashAccounts', 'ผังบัญชียังไม่มีบัญชีเงินสด/ธนาคาร (สินทรัพย์รหัส 10xx)')}
                </Alert>
              ) : null}
            </section>

            {/* ขั้นที่ 3 — the small print */}
            <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
              <div>
                <p className="orva-kicker">{t('orva_finance.expense.step3.kicker', 'ขั้นที่ 3')}</p>
                <h2 className="text-base font-semibold">{t('orva_finance.expense.step3.title', 'เรื่องภาษี')}</h2>
                <p className="text-sm text-muted-foreground">{t('orva_finance.expense.step3.hint', 'ตอบตามที่พิมพ์อยู่บนใบ ไม่ต้องคำนวณเอง')}</p>
              </div>
              <RadioGroup value={form.kind} onValueChange={(value) => update({ kind: value as ReceiptKind, vatOverride: null })} aria-label={t('orva_finance.expense.kind', 'ใบเสร็จนี้เป็นแบบไหน')}>
                <RadioField value="plain" label={t('orva_finance.expense.kind.plain', 'ใบเสร็จธรรมดา หรือใบกำกับภาษีอย่างย่อ')} description={t('orva_finance.expense.kind.plainHelp', 'ไม่มีชื่อบริษัทเราบนใบ — ลงเป็นค่าใช้จ่ายทั้งจำนวน ไม่ขอคืนภาษีซื้อ')} />
                <RadioField value="full" label={t('orva_finance.expense.kind.full', 'ใบกำกับภาษีเต็มรูป (มีชื่อบริษัทเรา)')} description={t('orva_finance.expense.kind.fullHelp', 'ระบบแยก VAT 7% ออกจากยอดรวมให้ และส่งเข้ารายงานภาษีซื้อ ภ.พ.30')} />
              </RadioGroup>
              {form.kind === 'full' ? (
                <div className="flex flex-col gap-3 border-l-2 border-border pl-4">
                  {vatBlocked ? (
                    <Alert status="warning" action={<Button asChild size="sm" variant="outline"><Link href="/backend/ap/bills">{t('orva_finance.expense.goSettings', 'ไปตั้งค่า')}</Link></Button>}>
                      {t('orva_finance.expense.vatAccountMissing', 'ยังไม่ได้ตั้งบัญชีภาษีซื้อ — ตั้งครั้งเดียวที่หน้าบิลผู้ขาย แล้วใบกำกับภาษีทุกใบจะเข้า ภ.พ.30 ให้เอง')}
                    </Alert>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField label={t('orva_finance.expense.payeeTaxId', 'เลขผู้เสียภาษีผู้ขาย')} required description={t('orva_finance.expense.payeeTaxIdHelp', '13 หลัก อยู่ใกล้ชื่อร้านบนใบกำกับ')}>
                      <Input inputMode="numeric" value={form.payeeTaxId} onChange={(e) => update({ payeeTaxId: e.target.value })} maxLength={20} />
                    </FormField>
                    <FormField label={t('orva_finance.expense.documentNo', 'เลขที่ใบกำกับภาษี')} required description={t('orva_finance.expense.documentNoHelp', 'ต้องมีทั้งสองช่องเพื่อยื่น ภ.พ.30')}>
                      <Input value={form.documentNo} onChange={(e) => update({ documentNo: e.target.value })} maxLength={60} />
                    </FormField>
                  </div>
                  {form.vatOverride === null ? (
                    <p className="text-sm text-muted-foreground">
                      {t('orva_finance.expense.vatAuto', 'VAT ที่แยกจากยอดรวม {vat} บาท (ค่าใช้จ่าย {net})').replace('{vat}', fmt(posting.vat)).replace('{net}', fmt(posting.net))}{' '}
                      <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => update({ vatOverride: String(posting.vat) })}>
                        {t('orva_finance.expense.vatOverrideLink', 'ใบกำกับพิมพ์ VAT ไว้ไม่เท่านี้? กรอกตามใบ')}
                      </button>
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1 sm:max-w-sm">
                      {/* Input stays the direct child: FormField wires the label to it by id */}
                      <FormField label={t('orva_finance.expense.vatAmount', 'VAT ตามที่พิมพ์ในใบกำกับ (บาท)')}
                        description={t('orva_finance.expense.vatAmountHelp', 'ค่าใช้จ่ายจะเป็นยอดรวมหัก VAT นี้')}
                        error={posting.errors.includes('vat') ? t('orva_finance.expense.vatError', 'VAT ต้องน้อยกว่ายอดรวม') : undefined}>
                        <Input type="number" inputMode="decimal" min="0" step="0.01" value={form.vatOverride} onChange={(e) => update({ vatOverride: e.target.value })} className="text-right tabular-nums" />
                      </FormField>
                      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => update({ vatOverride: null })}>{t('orva_finance.expense.vatAutoBack', 'กลับไปใช้ 7% อัตโนมัติ')}</Button>
                    </div>
                  )}
                </div>
              ) : null}
              <SwitchField
                checked={form.whtOn}
                onCheckedChange={(checked) => update({ whtOn: checked, whtAmount: null })}
                label={t('orva_finance.expense.whtOn', 'หักภาษี ณ ที่จ่ายจากยอดนี้')}
                description={t('orva_finance.expense.whtOnHelp', 'ซื้อของทั่วไปไม่หัก — หักเมื่อจ่ายค่าบริการ ค่าจ้าง ค่าเช่า ค่าโฆษณา แล้วเราออกหนังสือรับรองให้ผู้รับเงิน')}
              />
              {form.whtOn ? (
                <div className="flex flex-col gap-3 border-l-2 border-border pl-4">
                  {whtBlocked ? (
                    <Alert status="warning" action={<Button asChild size="sm" variant="outline"><Link href="/backend/ap/bills">{t('orva_finance.expense.goSettings', 'ไปตั้งค่า')}</Link></Button>}>
                      {t('orva_finance.expense.whtAccountMissing', 'ยังไม่ได้ตั้งบัญชีภาษีหัก ณ ที่จ่ายค้างนำส่ง — ตั้งครั้งเดียวที่หน้าบิลผู้ขาย')}
                    </Alert>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField label={t('orva_finance.expense.whtRate', 'อัตรา')} description={t('orva_finance.expense.whtRateHelp', '3% ค่าบริการ/ค่าจ้าง · 1% ค่าขนส่ง · 2% ค่าโฆษณา · 5% ค่าเช่า')}>
                      <div className="flex flex-col gap-2">
                        <SegmentedControl size="sm" value={form.whtRate} onValueChange={(value) => update({ whtRate: value, whtAmount: null })} className="w-full">
                          {WHT_RATES.map((r) => <SegmentedControlItem key={r} value={r} className="flex-1">{r}%</SegmentedControlItem>)}
                          <SegmentedControlItem value="other" className="flex-1">{t('orva_finance.expense.whtRateOther', 'อื่น')}</SegmentedControlItem>
                        </SegmentedControl>
                        {form.whtRate === 'other' ? (
                          <Input type="number" inputMode="decimal" min="0" max="100" step="0.5" value={form.whtRateOther} onChange={(e) => update({ whtRateOther: e.target.value, whtAmount: null })} aria-label={t('orva_finance.expense.whtRateOtherLabel', 'อัตราที่ใช้ (%)')} placeholder="%" className="w-28 text-right tabular-nums" />
                        ) : null}
                      </div>
                    </FormField>
                    <div className="flex flex-col gap-1">
                      <FormField label={t('orva_finance.expense.wht', 'จำนวนที่หัก (บาท)')}
                        description={t('orva_finance.expense.whtHelp', 'คำนวณจากยอดก่อน VAT × อัตรา แก้ได้ถ้าหนังสือรับรองระบุต่างไป')}
                        error={posting.errors.includes('wht') ? t('orva_finance.expense.whtError', 'จำนวนที่หักต้องน้อยกว่ายอดค่าใช้จ่าย') : undefined}>
                        <Input type="number" inputMode="decimal" min="0" step="0.01" value={form.whtAmount ?? String(suggestedWithholding(posting.net, rate))} onChange={(e) => update({ whtAmount: e.target.value })} className="text-right tabular-nums" />
                      </FormField>
                      {form.whtAmount !== null ? <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => update({ whtAmount: null })}>{t('orva_finance.expense.whtRecalc', 'คำนวณใหม่')}</Button> : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          </div>

          {/* The posting the accountant will see — before the save, not after */}
          <aside className="lg:col-span-2">
            <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 lg:sticky lg:top-4">
              <p className="orva-kicker">{t('orva_finance.expense.preview.kicker', 'เมื่อกดบันทึก ระบบจะลงบัญชีแบบนี้')}</p>
              <dl className="flex flex-col gap-2 text-sm" aria-live="polite">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className={expenseAccount ? '' : 'text-muted-foreground'}>{t('orva_finance.expense.preview.expense', 'ค่าใช้จ่าย')} · {expenseAccount?.name ?? t('orva_finance.expense.preview.noCategory', 'ยังไม่เลือกหมวด')}</dt>
                  <dd className="tabular-nums">{fmt(posting.net)}</dd>
                </div>
                <div className={`flex items-baseline justify-between gap-3 ${posting.vat > 0 ? '' : 'text-muted-foreground'}`}>
                  <dt>{t('orva_finance.expense.preview.vat', 'ภาษีซื้อ')} · {posting.vat > 0 ? t('orva_finance.expense.preview.vatInto', 'เข้า ภ.พ.30') : t('orva_finance.expense.preview.none', 'ไม่มี')}</dt>
                  <dd className="tabular-nums">{posting.vat > 0 ? fmt(posting.vat) : '—'}</dd>
                </div>
                {form.whtOn ? (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt>{t('orva_finance.expense.preview.wht', 'หัก ณ ที่จ่าย {rate}% · เข้า ภ.ง.ด.3/53').replace('{rate}', String(rate))}</dt>
                    <dd className="tabular-nums">−{fmt(posting.wht)}</dd>
                  </div>
                ) : null}
                <div className="mt-1 flex items-baseline justify-between gap-3 border-t pt-2 font-medium">
                  <dt>{t('orva_finance.expense.preview.cashOut', 'เงินออกจาก')} {cashAccount?.name ?? t('orva_finance.expense.preview.noCash', 'ยังไม่เลือกบัญชี')}</dt>
                  <dd className="orva-ledger-total text-lg font-semibold tabular-nums">{fmt(posting.cashOut)}</dd>
                </div>
              </dl>
              {form.payee || form.paidOn ? (
                <p className="text-xs text-muted-foreground">
                  {t('orva_finance.expense.preview.recap', 'จ่ายให้ {payee} · {date}').replace('{payee}', form.payee || '—').replace('{date}', form.paidOn ? fmtDate(form.paidOn) : '—')}
                </p>
              ) : null}
              <Button type="submit" disabled={!canSubmit} className="w-full">
                {saving ? t('orva_finance.expense.saving', 'กำลังลงบัญชี…') : t('orva_finance.expense.submit', 'บันทึกและลงบัญชี')}
              </Button>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t('orva_finance.expense.shortcut', 'Enter หรือ Ctrl+Enter เพื่อบันทึก')}</span>
                <button type="button" className="hover:underline" onClick={() => void askToClear()}>{t('orva_finance.expense.clearForm', 'ล้างฟอร์ม')}</button>
              </div>
              {fullNeedsIds && touched ? <p className="text-xs text-muted-foreground">{t('orva_finance.expense.needIds', 'ใบกำกับภาษีเต็มรูปต้องมีเลขผู้เสียภาษีและเลขที่ใบกำกับ')}</p> : null}
              {saveError ? <Alert status="error">{saveError}</Alert> : null}
              {saved ? (
                <Alert status={saved.uploadFailed ? 'warning' : 'success'} action={<Button asChild size="sm" variant="outline"><Link href="/backend/gl/journals">{t('orva_finance.expense.viewJournal', 'ดูในสมุดรายวัน')}</Link></Button>}>
                  {t('orva_finance.expense.savedDetail', 'ลงบัญชีแล้ว {journal} · เงินออก {cash} บาท').replace('{journal}', saved.journalNo).replace('{cash}', fmt(saved.cashOut))}
                  {saved.uploadFailed ? ` — ${t('orva_finance.expense.receiptFailed', 'แต่แนบรูปใบเสร็จไม่สำเร็จ')}` : ''}
                </Alert>
              ) : null}
            </div>
          </aside>
        </form>

        {/* The month — what the accounting firm receives */}
        <section className="mt-8 flex flex-col gap-3">
          <SectionHeader
            title={t('orva_finance.expense.list.title', 'รายการเดือนนี้')}
            count={items.length}
            action={(
              <div className="flex flex-wrap items-center gap-2">
                <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" aria-label={t('orva_finance.expense.list.month', 'เดือน')} />
                <Button asChild variant="ghost" size="sm"><Link href="/backend/reports/vat">{t('orva_finance.expense.list.vatReport', 'ดู ภ.พ.30')}</Link></Button>
                <Button asChild variant="ghost" size="sm"><Link href="/backend/reports/wht">{t('orva_finance.expense.list.whtReport', 'ดูทะเบียนหัก ณ ที่จ่าย')}</Link></Button>
              </div>
            )}
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {([
              ['net', t('orva_finance.expense.total.net', 'ค่าใช้จ่ายรวม')],
              ['vat', t('orva_finance.expense.total.vat', 'ภาษีซื้อรวม')],
              ['wht', t('orva_finance.expense.total.wht', 'หัก ณ ที่จ่ายรวม')],
              ['paid', t('orva_finance.expense.total.paid', 'เงินออกรวม')],
            ] as const).map(([key, label]) => (
              <div key={key} className="rounded-lg border bg-card px-4 py-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                {list.isLoading ? <Skeleton className="mt-1 h-7 w-24" /> : (
                  <p className={`text-xl font-semibold tabular-nums ${key === 'paid' ? 'orva-ledger-total inline-block' : ''}`}>{fmt(totals[key])}</p>
                )}
              </div>
            ))}
          </div>
          {list.isError ? (
            <Alert status="error" action={<Button type="button" size="sm" variant="outline" onClick={() => void list.refetch()}>{t('orva_finance.expense.retry', 'ลองใหม่')}</Button>}>
              {t('orva_finance.expense.list.failed', 'โหลดรายการไม่สำเร็จ')}
            </Alert>
          ) : list.isLoading ? (
            <Skeleton shape="text" lines={4} />
          ) : items.length === 0 ? (
            <OrvaEmptyState
              title={t('orva_finance.expense.empty', 'ยังไม่มีค่าใช้จ่ายในเดือนนี้')}
              description={t('orva_finance.expense.emptyHelp', 'บันทึกใบเสร็จแรกจากฟอร์มด้านบน — ทุกใบที่บันทึกจะลงบัญชีและเข้ารายงานภาษีให้เอง')}
            />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('orva_finance.expense.col.date', 'วันที่')}</TableHead>
                    <TableHead>{t('orva_finance.expense.col.payee', 'จ่ายให้')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('orva_finance.expense.col.category', 'หมวด')}</TableHead>
                    <TableHead className="text-right">{t('orva_finance.expense.col.net', 'ค่าใช้จ่าย')}</TableHead>
                    <TableHead className="hidden text-right md:table-cell">{t('orva_finance.expense.col.vat', 'ภาษีซื้อ')}</TableHead>
                    <TableHead className="hidden text-right md:table-cell">{t('orva_finance.expense.col.wht', 'หัก ณ ที่จ่าย')}</TableHead>
                    <TableHead className="text-right">{t('orva_finance.expense.col.paid', 'เงินออก')}</TableHead>
                    <TableHead>{t('orva_finance.expense.col.journal', 'สมุดรายวัน')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((e) => (
                    <TableRow key={e.journalId}>
                      <TableCell className="whitespace-nowrap">{fmtDate(e.paidOn)}</TableCell>
                      <TableCell>
                        <div className="font-medium">{e.payee ?? '—'}</div>
                        {e.documentNo || e.memo ? <div className="text-xs text-muted-foreground">{[e.documentNo, e.memo].filter(Boolean).join(' · ')}</div> : null}
                      </TableCell>
                      <TableCell className="hidden text-xs md:table-cell">{e.expenseAccount ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(e.net)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">{Number(e.vat) > 0 ? fmt(e.vat) : '—'}</TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">{Number(e.wht) > 0 ? fmt(e.wht) : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(e.paid)}</TableCell>
                      <TableCell><Link href="/backend/gl/journals" className="text-primary hover:underline">{e.journalNo}</Link></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
