"use client"
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { createCrud, fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const LIST_HREF = '/backend/ar/receipts'

type AccountOption = { id: string; code: string; name: string }
type PeriodOption = { id: string; code: string }
type OpenItem = {
  invoice_id: string
  invoice_number: string
  posted_amount: string
  received_amount: string
  remaining_amount: string
  posted_on: string | null
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function ReceiptCreateForm() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [cashAccountId, setCashAccountId] = React.useState('')
  const [periodId, setPeriodId] = React.useState('')
  const [receiptDate, setReceiptDate] = React.useState(() => new Date().toISOString().slice(0, 10))
  const [memo, setMemo] = React.useState('')
  const [whtRate, setWhtRate] = React.useState('3')
  const [whtAmount, setWhtAmount] = React.useState('')
  const [amounts, setAmounts] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const { data: cashAccountsData } = useQuery({
    queryKey: ['orva_finance.accounts.asset', scopeVersion],
    queryFn: async () =>
      fetchCrudList<AccountOption>('orva_finance/gl/accounts', {
        page: 1, pageSize: 100, sortField: 'code', sortDir: 'asc', accountType: 'asset', isActive: true,
      }),
  })
  const { data: periodsData } = useQuery({
    queryKey: ['orva_finance.periods.open', scopeVersion],
    queryFn: async () =>
      fetchCrudList<PeriodOption>('orva_finance/gl/periods', {
        page: 1, pageSize: 100, sortField: 'starts_on', sortDir: 'desc', status: 'open',
      }),
  })
  const { data: openItemsData, isLoading } = useQuery({
    queryKey: ['orva_finance.ar.open-items', scopeVersion],
    queryFn: async () => readApiResultOrThrow<{ items: OpenItem[] }>('/api/orva_finance/ar/open-items'),
  })

  const items = openItemsData?.items ?? []
  const allocations = React.useMemo(
    () =>
      Object.entries(amounts)
        .map(([invoiceId, value]) => ({ invoiceId, amount: Number(value) || 0 }))
        .filter((a) => a.amount > 0),
    [amounts],
  )
  const total = allocations.reduce((sum, a) => sum + a.amount, 0)
  const wht = Number(whtAmount) || 0
  const cashIn = total - wht
  const overAllocated = allocations.some((a) => {
    const item = items.find((i) => i.invoice_id === a.invoiceId)
    return !item || a.amount > Number(item.remaining_amount) + 0.00005
  })
  const canSubmit = Boolean(cashAccountId && periodId && receiptDate && allocations.length >= 1 && !overAllocated && wht >= 0 && wht < total && !submitting)

  const fmt = (v: string | number) =>
    Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const submit = async () => {
    setError(null)
    setSubmitting(true)
    try {
      await createCrud('orva_finance/ar/receipts', {
        cashAccountId,
        periodId,
        receiptDate,
        currencyCode: 'THB',
        memo: memo || null,
        allocations,
        whtAmount: wht,
        whtRate: wht > 0 && whtRate ? Number(whtRate) : null,
      })
      flash(t('orva_finance.receipts.flash.created', 'Draft receipt created'), 'success')
      router.push(LIST_HREF)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('orva_finance.receipts.form.error.create', 'Failed to create receipt'))
      setSubmitting(false)
    }
  }

  return (
    <Page>
      <PageHeader
        title={t('orva_finance.receipts.form.create.title', 'Create customer receipt')}
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href={LIST_HREF}>{t('orva_finance.form.cancel', 'Cancel')}</Link>
            </Button>
            <Button onClick={submit} disabled={!canSubmit}>
              {t('orva_finance.receipts.form.create.submit', 'Create draft')}
            </Button>
          </div>
        )}
      />
      <PageBody>
        <div className="flex flex-col gap-6">
          {error ? <div className="text-sm text-destructive">{error}</div> : null}

          <div className="grid gap-4 md:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('orva_finance.receipts.form.cashAccount', 'Received into (asset)')} *</span>
              <select className={selectClass} value={cashAccountId} onChange={(e) => setCashAccountId(e.target.value)}>
                <option value="">{t('orva_finance.journals.form.selectAccount', '— select account —')}</option>
                {(cashAccountsData?.items ?? []).map((a) => (<option key={a.id} value={a.id}>{a.code} · {a.name}</option>))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('orva_finance.periods.column.code', 'Period')} *</span>
              <select className={selectClass} value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
                <option value="">{t('orva_finance.journals.form.selectPeriod', '— select open period —')}</option>
                {(periodsData?.items ?? []).map((p) => (<option key={p.id} value={p.id}>{p.code}</option>))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('orva_finance.ap.column.date', 'Date')} *</span>
              <Input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('orva_finance.journals.column.memo', 'Memo')}</span>
              <Input value={memo} onChange={(e) => setMemo(e.target.value)} />
            </label>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-3 py-2">{t('orva_finance.ar.column.invoice', 'Invoice #')}</th>
                  <th className="px-3 py-2">{t('orva_finance.receipts.form.postedOn', 'Posted')}</th>
                  <th className="px-3 py-2 text-right">{t('orva_finance.ap.column.total', 'Total')}</th>
                  <th className="px-3 py-2 text-right">{t('orva_finance.receipts.form.received', 'Received')}</th>
                  <th className="px-3 py-2 text-right">{t('orva_finance.payments.form.remaining', 'Remaining')}</th>
                  <th className="px-3 py-2 w-40 text-right">{t('orva_finance.receipts.form.receiveAmount', 'Receive')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td className="px-3 py-6 text-center text-muted-foreground" colSpan={6}>…</td></tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-muted-foreground" colSpan={6}>
                      {t('orva_finance.receipts.form.noOpenItems', 'No open AR items — all posted invoices are settled')}
                    </td>
                  </tr>
                ) : items.map((item) => {
                  const remaining = Number(item.remaining_amount)
                  const value = amounts[item.invoice_id] ?? ''
                  const over = (Number(value) || 0) > remaining + 0.00005
                  return (
                    <tr key={item.invoice_id} className="border-b last:border-b-0">
                      <td className="px-3 py-2 font-medium">{item.invoice_number}</td>
                      <td className="px-3 py-2">{item.posted_on ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(item.posted_amount)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(item.received_amount)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(remaining)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <Input
                            type="number" min="0" step="0.01"
                            className={`text-right tabular-nums ${over ? 'border-destructive' : ''}`}
                            value={value}
                            onChange={(e) => setAmounts((prev) => ({ ...prev, [item.invoice_id]: e.target.value }))}
                          />
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => setAmounts((prev) => ({ ...prev, [item.invoice_id]: remaining.toFixed(2) }))}
                          >
                            {t('orva_finance.payments.form.payFull', 'Full')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-muted/30 font-medium">
                  <td className="px-3 py-2 text-right" colSpan={5}>{t('orva_finance.receipts.form.total', 'Receipt total')}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${overAllocated ? 'text-destructive' : ''}`}>{fmt(total)}</td>
                </tr>
                <tr className="bg-muted/30">
                  <td className="px-3 py-2" colSpan={4}>
                    <div className="flex flex-wrap items-center gap-2 text-sm font-normal">
                      <span>{t('orva_finance.receipts.form.wht', 'ภาษีถูกหัก ณ ที่จ่าย')}</span>
                      <Input type="number" min="0" max="100" step="0.5" className="w-20 text-right" value={whtRate} onChange={(e) => setWhtRate(e.target.value)} aria-label="%" />
                      <span>%</span>
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => setWhtAmount((Math.round((total / 1.07) * (Number(whtRate) || 0)) / 100).toFixed(2))}
                        disabled={total <= 0}
                      >
                        {t('orva_finance.receipts.form.whtCompute', 'คำนวณจากยอดก่อน VAT')}
                      </Button>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">{t('orva_finance.receipts.form.whtAmount', 'หัก ณ ที่จ่าย')}</td>
                  <td className="px-3 py-2">
                    <Input type="number" min="0" step="0.01" className={`text-right tabular-nums ${wht >= total && total > 0 ? 'border-destructive' : ''}`} value={whtAmount} onChange={(e) => setWhtAmount(e.target.value)} />
                  </td>
                </tr>
                <tr className="bg-muted/30 font-medium">
                  <td className="px-3 py-2 text-right" colSpan={5}>{t('orva_finance.receipts.form.cashIn', 'เงินเข้าบัญชีจริง')}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(cashIn)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-xs text-muted-foreground max-w-prose">
            {t(
              'orva_finance.receipts.form.hint',
              'Posting debits the selected asset account with the cash received, debits WHT receivable with the tax the customer withheld, and credits the AR control account with the full allocation.',
            )}
          </p>
        </div>
      </PageBody>
    </Page>
  )
}
