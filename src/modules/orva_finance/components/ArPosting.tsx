"use client"
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type AccountOption = { id: string; code: string; name: string; account_type: string }
type PeriodOption = { id: string; code: string }
type InvoiceRow = {
  id: string
  invoice_number: string
  status: string | null
  issue_date: string | null
  currency_code: string
  grand_total_gross_amount: string
  tax_total_amount: string
}
type ArSettingsDto = {
  arAccountId: string | null
  revenueAccountId: string | null
  taxAccountId: string | null
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'

function ArSettingsCard({ settings }: { settings: ArSettingsDto }) {
  const t = useT()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [ar, setAr] = React.useState(settings.arAccountId ?? '')
  const [revenue, setRevenue] = React.useState(settings.revenueAccountId ?? '')
  const [tax, setTax] = React.useState(settings.taxAccountId ?? '')
  const [saving, setSaving] = React.useState(false)

  const { data: accountsData } = useQuery({
    queryKey: ['orva_finance.accounts.all', scopeVersion],
    queryFn: async () =>
      fetchCrudList<AccountOption>('orva_finance/gl/accounts', {
        page: 1, pageSize: 100, sortField: 'code', sortDir: 'asc', isActive: true,
      }),
  })
  const accounts = accountsData?.items ?? []
  const byType = (type: string) => accounts.filter((a) => a.account_type === type)

  return (
    <div className="mb-4 grid gap-3 rounded-md border px-4 py-3 text-sm md:grid-cols-4">
      <label className="flex flex-col gap-1">
        <span className="font-medium">{t('orva_finance.ar.settings.arAccount', 'AR control (asset)')} *</span>
        <select className={selectClass} value={ar} onChange={(e) => setAr(e.target.value)}>
          <option value="">{t('orva_finance.journals.form.selectAccount', '— select account —')}</option>
          {byType('asset').map((a) => (<option key={a.id} value={a.id}>{a.code} · {a.name}</option>))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">{t('orva_finance.ar.settings.revenueAccount', 'Revenue (income)')} *</span>
        <select className={selectClass} value={revenue} onChange={(e) => setRevenue(e.target.value)}>
          <option value="">{t('orva_finance.journals.form.selectAccount', '— select account —')}</option>
          {byType('income').map((a) => (<option key={a.id} value={a.id}>{a.code} · {a.name}</option>))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">{t('orva_finance.ar.settings.taxAccount', 'Tax payable (optional)')}</span>
        <select className={selectClass} value={tax} onChange={(e) => setTax(e.target.value)}>
          <option value="">{t('orva_finance.ar.settings.noTax', '— none (revenue gross) —')}</option>
          {byType('liability').map((a) => (<option key={a.id} value={a.id}>{a.code} · {a.name}</option>))}
        </select>
      </label>
      <div className="flex items-end">
        <Button
          size="sm" disabled={!ar || !revenue || saving}
          onClick={async () => {
            setSaving(true)
            try {
              await readApiResultOrThrow('/api/orva_finance/ar/settings', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ arAccountId: ar, revenueAccountId: revenue, taxAccountId: tax || null }),
              })
              flash(t('orva_finance.ar.settings.saved', 'AR accounts saved'), 'success')
              queryClient.invalidateQueries({ queryKey: ['orva_finance.ar.settings'] })
            } finally {
              setSaving(false)
            }
          }}
        >
          {t('orva_finance.form.edit.submit', 'Save')}
        </Button>
      </div>
    </div>
  )
}

export default function ArPosting() {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const [selected, setSelected] = React.useState<Record<string, boolean>>({})
  const [periodId, setPeriodId] = React.useState('')
  const [postingDate, setPostingDate] = React.useState(() => new Date().toISOString().slice(0, 10))
  const [posting, setPosting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const { data: settings } = useQuery({
    queryKey: ['orva_finance.ar.settings', scopeVersion],
    queryFn: async () => readApiResultOrThrow<ArSettingsDto>('/api/orva_finance/ar/settings'),
  })
  const { data: periodsData } = useQuery({
    queryKey: ['orva_finance.periods.open', scopeVersion],
    queryFn: async () =>
      fetchCrudList<PeriodOption>('orva_finance/gl/periods', {
        page: 1, pageSize: 100, sortField: 'starts_on', sortDir: 'desc', status: 'open',
      }),
  })
  const { data: invoicesData, isLoading } = useQuery({
    queryKey: ['orva_finance.ar.unposted', scopeVersion],
    queryFn: async () => readApiResultOrThrow<{ items: InvoiceRow[] }>('/api/orva_finance/ar/unposted-invoices'),
  })

  const invoices = invoicesData?.items ?? []
  const configured = Boolean(settings?.arAccountId && settings?.revenueAccountId)
  const selectedIds = Object.entries(selected).filter(([, on]) => on).map(([id]) => id)
  const selectedTotal = invoices
    .filter((invoice) => selected[invoice.id])
    .reduce((sum, invoice) => sum + Number(invoice.grand_total_gross_amount), 0)
  const canPost = configured && selectedIds.length > 0 && periodId && postingDate && !posting

  const fmt = (v: string | number) =>
    Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const post = async () => {
    const confirmed = await confirm({
      title: t('orva_finance.ar.confirmPost', 'Post the selected invoices to the ledger?'),
      description: `${selectedIds.length} × → ${fmt(selectedTotal)}`,
    })
    if (!confirmed) return
    setError(null)
    setPosting(true)
    try {
      await readApiResultOrThrow('/api/orva_finance/ar/post', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ invoiceIds: selectedIds, periodId, postingDate }),
      })
      flash(t('orva_finance.ar.flash.posted', 'Invoices posted to the ledger'), 'success')
      setSelected({})
      queryClient.invalidateQueries({ queryKey: ['orva_finance.ar.unposted'] })
      queryClient.invalidateQueries({ queryKey: ['orva_finance.journals'] })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('orva_finance.ar.error.post', 'Posting failed'))
    } finally {
      setPosting(false)
    }
  }

  return (
    <Page>
      <PageHeader
        title={t('orva_finance.ar.page.title', 'AR Posting')}
        actions={(
          <div className="flex items-center gap-2 text-sm">
            <select className={selectClass} value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
              <option value="">{t('orva_finance.journals.form.selectPeriod', '— select open period —')}</option>
              {(periodsData?.items ?? []).map((p) => (<option key={p.id} value={p.id}>{p.code}</option>))}
            </select>
            <Input type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} />
            <Button onClick={post} disabled={!canPost}>
              {t('orva_finance.ar.actions.post', 'Post selected')} {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
            </Button>
          </div>
        )}
      />
      <PageBody>
        {settings ? <ArSettingsCard settings={settings} /> : null}
        {!configured && settings ? (
          <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            {t('orva_finance.ar.settings.missing', 'Set the AR control and revenue accounts above before posting.')}
          </div>
        ) : null}
        {error ? <div className="mb-3 text-sm text-destructive">{error}</div> : null}

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={invoices.length > 0 && selectedIds.length === invoices.length}
                    onChange={(e) => {
                      const on = e.target.checked
                      setSelected(Object.fromEntries(invoices.map((invoice) => [invoice.id, on])))
                    }}
                  />
                </th>
                <th className="px-3 py-2">{t('orva_finance.ar.column.invoice', 'Invoice #')}</th>
                <th className="px-3 py-2">{t('orva_finance.ap.column.date', 'Date')}</th>
                <th className="px-3 py-2">{t('orva_finance.journals.column.status', 'Status')}</th>
                <th className="px-3 py-2 text-right">{t('orva_finance.ar.column.tax', 'Tax')}</th>
                <th className="px-3 py-2 text-right">{t('orva_finance.ap.column.total', 'Total')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td className="px-3 py-6 text-center text-muted-foreground" colSpan={6}>…</td></tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-muted-foreground" colSpan={6}>
                    {t('orva_finance.ar.empty', 'No unposted sales invoices — everything is in the ledger')}
                  </td>
                </tr>
              ) : invoices.map((invoice) => (
                <tr key={invoice.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={Boolean(selected[invoice.id])}
                      onChange={(e) => setSelected((prev) => ({ ...prev, [invoice.id]: e.target.checked }))}
                    />
                  </td>
                  <td className="px-3 py-2 font-medium">{invoice.invoice_number}</td>
                  <td className="px-3 py-2">{invoice.issue_date ?? '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{invoice.status ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(invoice.tax_total_amount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(invoice.grand_total_gross_amount)}</td>
                </tr>
              ))}
            </tbody>
            {selectedIds.length > 0 ? (
              <tfoot>
                <tr className="bg-muted/30 font-semibold">
                  <td className="px-3 py-2" colSpan={5}>{t('orva_finance.ar.selectedTotal', 'Selected total')}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(selectedTotal)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>

        <p className="mt-3 text-xs text-muted-foreground max-w-prose">
          {t(
            'orva_finance.ar.hint',
            'Each invoice books one journal: debit AR control, credit revenue (and tax payable when configured). A posted invoice cannot be posted twice.',
          )}
        </p>
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
