"use client"
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { createCrud, fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const LIST_HREF = '/backend/ap/payments'

type AccountOption = { id: string; code: string; name: string }
type PeriodOption = { id: string; code: string }
type PartyRoleRow = { id: string; party_id: string }
type PartyRow = { id: string; display_name: string }
type BillRow = {
  id: string
  bill_no?: string | null
  status: string
  bill_date: string
  due_date?: string | null
  total_amount?: string | number
  paid_amount?: string | number
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function PaymentCreateForm() {
  const t = useT()
  const router = useRouter()
  const [vendorPartyId, setVendorPartyId] = React.useState('')
  const [cashAccountId, setCashAccountId] = React.useState('')
  const [periodId, setPeriodId] = React.useState('')
  const [paymentDate, setPaymentDate] = React.useState(() => new Date().toISOString().slice(0, 10))
  const [memo, setMemo] = React.useState('')
  const [whtRate, setWhtRate] = React.useState('3')
  const [whtAmount, setWhtAmount] = React.useState('')
  const [whtType, setWhtType] = React.useState('ค่าบริการ')
  const [amounts, setAmounts] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const { data: vendorRolesData } = useQuery({
    queryKey: ['orva_party.vendor-roles'],
    queryFn: async () => fetchCrudList<PartyRoleRow>('orva_party/party-roles', { page: 1, pageSize: 100, role: 'vendor' }),
  })
  const vendorIds = React.useMemo(
    () => Array.from(new Set((vendorRolesData?.items ?? []).map((r) => r.party_id))),
    [vendorRolesData?.items],
  )
  const { data: vendorsData } = useQuery({
    queryKey: ['orva_party.vendors', vendorIds.join(',')],
    queryFn: async () => fetchCrudList<PartyRow>('orva_party/parties', { ids: vendorIds.join(','), pageSize: 100 }),
    enabled: vendorIds.length > 0,
  })
  const { data: cashAccountsData } = useQuery({
    queryKey: ['orva_finance.accounts.asset'],
    queryFn: async () =>
      fetchCrudList<AccountOption>('orva_finance/gl/accounts', {
        page: 1, pageSize: 100, sortField: 'code', sortDir: 'asc', accountType: 'asset', isActive: true,
      }),
  })
  const { data: periodsData } = useQuery({
    queryKey: ['orva_finance.periods.open'],
    queryFn: async () =>
      fetchCrudList<PeriodOption>('orva_finance/gl/periods', {
        page: 1, pageSize: 100, sortField: 'starts_on', sortDir: 'desc', status: 'open',
      }),
  })
  const { data: billsData } = useQuery({
    queryKey: ['orva_finance.ap.open-bills', vendorPartyId],
    queryFn: async () =>
      fetchCrudList<BillRow>('orva_finance/ap/bills', {
        page: 1, pageSize: 100, sortField: 'bill_date', sortDir: 'asc',
        status: 'posted', vendorPartyId,
      }),
    enabled: Boolean(vendorPartyId),
  })

  const openBills = React.useMemo(
    () => (billsData?.items ?? []).filter((b) => Number(b.total_amount ?? 0) - Number(b.paid_amount ?? 0) > 0.00005),
    [billsData?.items],
  )

  const remaining = (bill: BillRow) => Number(bill.total_amount ?? 0) - Number(bill.paid_amount ?? 0)

  const allocations = React.useMemo(
    () =>
      Object.entries(amounts)
        .map(([billId, value]) => ({ billId, amount: Number(value) || 0 }))
        .filter((a) => a.amount > 0),
    [amounts],
  )
  const total = allocations.reduce((sum, a) => sum + a.amount, 0)
  const wht = Number(whtAmount) || 0
  const cashOut = total - wht
  const overAllocated = allocations.some((a) => {
    const bill = openBills.find((b) => b.id === a.billId)
    return !bill || a.amount > remaining(bill) + 0.00005
  })
  const canSubmit = Boolean(
    vendorPartyId && cashAccountId && periodId && paymentDate && allocations.length >= 1 && !overAllocated && wht >= 0 && wht < total && !submitting,
  )

  const submit = async () => {
    setError(null)
    setSubmitting(true)
    try {
      await createCrud('orva_finance/ap/payments', {
        vendorPartyId,
        cashAccountId,
        periodId,
        paymentDate,
        currencyCode: 'THB',
        memo: memo || null,
        allocations,
        whtAmount: wht,
        whtRate: wht > 0 && whtRate ? Number(whtRate) : null,
        whtType: wht > 0 ? whtType || null : null,
      })
      flash(t('orva_finance.payments.flash.created', 'Draft payment created'), 'success')
      router.push(LIST_HREF)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('orva_finance.payments.form.error.create', 'Failed to create payment'))
      setSubmitting(false)
    }
  }

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <Page>
      <PageHeader
        title={t('orva_finance.payments.form.create.title', 'Create vendor payment')}
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href={LIST_HREF}>{t('orva_finance.form.cancel', 'Cancel')}</Link>
            </Button>
            <Button onClick={submit} disabled={!canSubmit}>
              {t('orva_finance.payments.form.create.submit', 'Create draft')}
            </Button>
          </div>
        )}
      />
      <PageBody>
        <div className="flex flex-col gap-6">
          {error ? <div className="text-sm text-destructive">{error}</div> : null}

          <div className="grid gap-4 md:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('orva_finance.ap.column.vendor', 'Vendor')} *</span>
              <select
                className={selectClass}
                value={vendorPartyId}
                onChange={(e) => { setVendorPartyId(e.target.value); setAmounts({}) }}
              >
                <option value="">{t('orva_finance.ap.form.selectVendor', '— select vendor —')}</option>
                {(vendorsData?.items ?? []).map((v) => (<option key={v.id} value={v.id}>{v.display_name}</option>))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('orva_finance.payments.form.cashAccount', 'Paid from (asset)')} *</span>
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
              <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
            </label>
          </div>

          {vendorPartyId ? (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="px-3 py-2">{t('orva_finance.ap.column.no', 'Bill #')}</th>
                    <th className="px-3 py-2">{t('orva_finance.ap.column.date', 'Date')}</th>
                    <th className="px-3 py-2">{t('orva_finance.ap.column.due', 'Due')}</th>
                    <th className="px-3 py-2 text-right">{t('orva_finance.ap.column.total', 'Total')}</th>
                    <th className="px-3 py-2 text-right">{t('orva_finance.payments.form.remaining', 'Remaining')}</th>
                    <th className="px-3 py-2 w-40 text-right">{t('orva_finance.payments.form.payAmount', 'Pay')}</th>
                  </tr>
                </thead>
                <tbody>
                  {openBills.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-muted-foreground" colSpan={6}>
                        {t('orva_finance.payments.form.noOpenBills', 'This vendor has no open posted bills')}
                      </td>
                    </tr>
                  ) : openBills.map((bill) => {
                    const rem = remaining(bill)
                    const value = amounts[bill.id] ?? ''
                    const over = (Number(value) || 0) > rem + 0.00005
                    return (
                      <tr key={bill.id} className="border-b last:border-b-0">
                        <td className="px-3 py-2 font-medium">{bill.bill_no}</td>
                        <td className="px-3 py-2">{bill.bill_date}</td>
                        <td className="px-3 py-2">{bill.due_date ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(Number(bill.total_amount ?? 0))}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(rem)}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <Input
                              type="number" min="0" step="0.01"
                              className={`text-right tabular-nums ${over ? 'border-destructive' : ''}`}
                              value={value}
                              onChange={(e) => setAmounts((prev) => ({ ...prev, [bill.id]: e.target.value }))}
                            />
                            <Button
                              variant="ghost" size="sm"
                              onClick={() => setAmounts((prev) => ({ ...prev, [bill.id]: rem.toFixed(2) }))}
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
                    <td className="px-3 py-2" colSpan={4}>
                      <label className="flex items-center gap-2 text-sm font-normal">
                        <span>{t('orva_finance.journals.column.memo', 'Memo')}</span>
                        <Input value={memo} onChange={(e) => setMemo(e.target.value)} className="max-w-72" />
                      </label>
                    </td>
                    <td className="px-3 py-2 text-right">{t('orva_finance.payments.form.total', 'Payment total')}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${overAllocated ? 'text-destructive' : ''}`}>{fmt(total)}</td>
                  </tr>
                                  <tr className="bg-muted/30">
                    <td className="px-3 py-2" colSpan={4}>
                      <div className="flex flex-wrap items-center gap-2 text-sm font-normal">
                        <span>{t('orva_finance.payments.form.wht', 'หักภาษี ณ ที่จ่าย')}</span>
                        <Input type="number" min="0" max="100" step="0.5" className="w-20 text-right" value={whtRate} onChange={(e) => setWhtRate(e.target.value)} aria-label="%" />
                        <span>%</span>
                        <Input className="w-40" value={whtType} onChange={(e) => setWhtType(e.target.value)} placeholder={t('orva_finance.payments.form.whtType', 'ประเภทเงินได้ เช่น ค่าบริการ')} />
                        <Button
                          variant="ghost" size="sm" disabled={total <= 0}
                          onClick={() => setWhtAmount((Math.round((total / 1.07) * (Number(whtRate) || 0)) / 100).toFixed(2))}
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
                    <td className="px-3 py-2 text-right" colSpan={5}>{t('orva_finance.payments.form.cashOut', 'เงินออกจากบัญชีจริง')}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(cashOut)}</td>
                  </tr>
</tfoot>
              </table>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground max-w-prose">
            {t(
              'orva_finance.payments.form.hint',
              'Posting debits the AP control account and credits the selected asset account, then settles each bill by the allocated amount.',
            )}
          </p>
        </div>
      </PageBody>
    </Page>
  )
}
