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

const LIST_HREF = '/backend/ap/bills'

type AccountOption = { id: string; code: string; name: string; account_type: string }
type PeriodOption = { id: string; code: string; starts_on: string; ends_on: string }
type PartyRoleRow = { id: string; party_id: string }
type PartyRow = { id: string; display_name: string }

type LineDraft = { key: number; expenseAccountId: string; amount: string; description: string }

const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function BillCreateForm() {
  const t = useT()
  const router = useRouter()
  const [vendorPartyId, setVendorPartyId] = React.useState('')
  const [vendorBillRef, setVendorBillRef] = React.useState('')
  const [periodId, setPeriodId] = React.useState('')
  const [billDate, setBillDate] = React.useState(() => new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = React.useState('')
  const [memo, setMemo] = React.useState('')
  const [taxAmount, setTaxAmount] = React.useState('')
  const [lines, setLines] = React.useState<LineDraft[]>([{ key: 1, expenseAccountId: '', amount: '', description: '' }])
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const nextKey = React.useRef(2)

  const { data: vendorRolesData } = useQuery({
    queryKey: ['orva_party.vendor-roles'],
    queryFn: async () =>
      fetchCrudList<PartyRoleRow>('orva_party/party-roles', { page: 1, pageSize: 100, role: 'vendor' }),
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
  const { data: accountsData } = useQuery({
    queryKey: ['orva_finance.accounts.expense'],
    queryFn: async () =>
      fetchCrudList<AccountOption>('orva_finance/gl/accounts', {
        page: 1, pageSize: 100, sortField: 'code', sortDir: 'asc', accountType: 'expense', isActive: true,
      }),
  })
  const { data: periodsData } = useQuery({
    queryKey: ['orva_finance.periods.open'],
    queryFn: async () =>
      fetchCrudList<PeriodOption>('orva_finance/gl/periods', {
        page: 1, pageSize: 100, sortField: 'starts_on', sortDir: 'desc', status: 'open',
      }),
  })

  const vendors = vendorsData?.items ?? []
  const accounts = accountsData?.items ?? []
  const periods = periodsData?.items ?? []

  const updateLine = (key: number, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  const addLine = () => setLines((prev) => [...prev, { key: nextKey.current++, expenseAccountId: '', amount: '', description: '' }])
  const removeLine = (key: number) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev))

  const total = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
  const tax = Number(taxAmount) || 0
  const gross = total + tax
  const linesValid = lines.every((line) => line.expenseAccountId && Number(line.amount) > 0)
  const canSubmit = Boolean(vendorPartyId && periodId && billDate && lines.length >= 1 && linesValid && !submitting)

  const submit = async () => {
    setError(null)
    setSubmitting(true)
    try {
      await createCrud('orva_finance/ap/bills', {
        vendorPartyId,
        vendorBillRef: vendorBillRef || null,
        periodId,
        billDate,
        dueDate: dueDate || null,
        currencyCode: 'THB',
        memo: memo || null,
        taxAmount: tax,
        lines: lines.map((line) => ({
          expenseAccountId: line.expenseAccountId,
          amount: Number(line.amount),
          description: line.description || null,
        })),
      })
      flash(t('orva_finance.ap.flash.created', 'Draft bill created'), 'success')
      router.push(LIST_HREF)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('orva_finance.ap.form.error.create', 'Failed to create bill'))
      setSubmitting(false)
    }
  }

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <Page>
      <PageHeader
        title={t('orva_finance.ap.form.create.title', 'Create vendor bill')}
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href={LIST_HREF}>{t('orva_finance.form.cancel', 'Cancel')}</Link>
            </Button>
            <Button onClick={submit} disabled={!canSubmit}>
              {t('orva_finance.ap.form.create.submit', 'Create draft')}
            </Button>
          </div>
        )}
      />
      <PageBody>
        <div className="flex flex-col gap-6">
          {error ? <div className="text-sm text-destructive">{error}</div> : null}
          {vendorIds.length === 0 && vendorRolesData ? (
            <div className="rounded-md border border-status-warning-border bg-status-warning-bg px-4 py-3 text-sm">
              {t('orva_finance.ap.form.noVendors', 'No parties hold the vendor role yet — assign it in Parties first.')}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('orva_finance.ap.column.vendor', 'Vendor')} *</span>
              <select className={selectClass} value={vendorPartyId} onChange={(e) => setVendorPartyId(e.target.value)}>
                <option value="">{t('orva_finance.ap.form.selectVendor', '— select vendor —')}</option>
                {vendors.map((v) => (<option key={v.id} value={v.id}>{v.display_name}</option>))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('orva_finance.ap.column.ref', 'Vendor ref')}</span>
              <Input value={vendorBillRef} onChange={(e) => setVendorBillRef(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('orva_finance.periods.column.code', 'Period')} *</span>
              <select className={selectClass} value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
                <option value="">{t('orva_finance.journals.form.selectPeriod', '— select open period —')}</option>
                {periods.map((p) => (<option key={p.id} value={p.id}>{p.code}</option>))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('orva_finance.ap.column.date', 'Date')} *</span>
              <Input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('orva_finance.ap.column.due', 'Due')}</span>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
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
                  <th className="px-3 py-2 w-8">#</th>
                  <th className="px-3 py-2 min-w-56">{t('orva_finance.ap.form.expenseAccount', 'Expense account')}</th>
                  <th className="px-3 py-2 w-36 text-right">{t('orva_finance.ap.form.amount', 'Amount')}</th>
                  <th className="px-3 py-2 min-w-40">{t('orva_finance.journals.form.description', 'Description')}</th>
                  <th className="px-3 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.key} className="border-b last:border-b-0 align-top">
                    <td className="px-3 py-2 text-muted-foreground">{index + 1}</td>
                    <td className="px-3 py-2">
                      <select
                        className={selectClass}
                        value={line.expenseAccountId}
                        onChange={(e) => updateLine(line.key, { expenseAccountId: e.target.value })}
                      >
                        <option value="">{t('orva_finance.journals.form.selectAccount', '— select account —')}</option>
                        {accounts.map((a) => (<option key={a.id} value={a.id}>{a.code} · {a.name}</option>))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number" min="0" step="0.01" className="text-right tabular-nums"
                        value={line.amount}
                        onChange={(e) => updateLine(line.key, { amount: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input value={line.description} onChange={(e) => updateLine(line.key, { description: e.target.value })} />
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        variant="ghost" size="sm" disabled={lines.length <= 1}
                        onClick={() => removeLine(line.key)}
                        aria-label={t('orva_finance.journals.form.removeLine', 'Remove line')}
                      >
                        ✕
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/30 font-medium">
                  <td className="px-3 py-2" colSpan={2}>
                    <Button variant="outline" size="sm" onClick={addLine}>
                      {t('orva_finance.journals.form.addLine', '+ Add line')}
                    </Button>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(total)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground" colSpan={2}>
                    {t('orva_finance.ap.form.totalHint', 'Posting debits these expenses and credits the AP control account')}
                  </td>
                </tr>
                <tr className="bg-muted/30">
                  <td className="px-3 py-2" colSpan={2}>
                    <div className="flex flex-wrap items-center gap-2 text-sm font-normal">
                      <span>{t('orva_finance.ap.form.tax', 'ภาษีซื้อ (VAT)')}</span>
                      <Button variant="ghost" size="sm" disabled={total <= 0} onClick={() => setTaxAmount((Math.round(total * 7) / 100).toFixed(2))}>
                        {t('orva_finance.ap.form.tax7', '7%')}
                      </Button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Input type="number" min="0" step="0.01" className="text-right tabular-nums" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} />
                  </td>
                  <td />
                </tr>
                <tr className="bg-muted/30 font-medium">
                  <td className="px-3 py-2 text-right" colSpan={2}>{t('orva_finance.ap.form.gross', 'ยอดรวมทั้งสิ้น (รวม VAT)')}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(gross)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
