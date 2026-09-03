"use client"
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type AccountOption = { id: string; code: string; name: string; account_type: string }
type LedgerLine = { journal_id: string; journal_no: string | null; journal_date: string; journal_kind: string; memo: string | null; description: string | null; debit: string; credit: string; balance: string }
type LedgerResponse = {
  account: AccountOption
  openingBalance: string
  lines: LedgerLine[]
  closingBalance: string
  totalDebit: string
  totalCredit: string
}

const selectClass =
  'h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'
const fmt = (v: string | number) => Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const firstOfMonth = () => new Date().toISOString().slice(0, 8) + '01'
const today = () => new Date().toISOString().slice(0, 10)

/** บัญชีแยกประเภท — one account, running balance; the สมุดเงินสด/ธนาคาร when the account is cash. */
export default function LedgerReport() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [accountId, setAccountId] = React.useState('')
  const [from, setFrom] = React.useState(firstOfMonth())
  const [to, setTo] = React.useState(today())

  const { data: accountsData } = useQuery({
    queryKey: ['orva_finance.accounts.all', scopeVersion],
    queryFn: async () =>
      fetchCrudList<AccountOption>('orva_finance/gl/accounts', { page: 1, pageSize: 100, sortField: 'code', sortDir: 'asc', isActive: true }),
  })
  React.useEffect(() => {
    if (!accountId && accountsData?.items?.length) {
      const bank = accountsData.items.find((a) => a.code === '1020') ?? accountsData.items[0]
      setAccountId(bank.id)
    }
  }, [accountsData, accountId])

  const { data, isLoading, error } = useQuery({
    queryKey: ['orva_finance.reports.ledger', accountId, from, to, scopeVersion],
    queryFn: async () => readApiResultOrThrow<LedgerResponse>(`/api/orva_finance/gl/reports/ledger?accountId=${accountId}&from=${from}&to=${to}`),
    enabled: Boolean(accountId && from && to),
  })

  return (
    <Page>
      <PageHeader
        title={t('orva_finance.ledger.page.title', 'บัญชีแยกประเภท')}
        actions={(
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <select className={`${selectClass} max-w-80`} value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label={t('orva_finance.accounts.page.title', 'Chart of Accounts')}>
              {(accountsData?.items ?? []).map((a) => (<option key={a.id} value={a.id}>{a.code} · {a.name}</option>))}
            </select>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
            <Button variant="outline" onClick={() => window.print()} disabled={!data}>{t('orva_finance.reports.print', 'พิมพ์')}</Button>
          </div>
        )}
      />
      <PageBody>
        {error ? <div className="text-sm text-destructive">{String(error)}</div> : null}
        {isLoading ? <div className="py-8 text-center text-sm text-muted-foreground">…</div> : null}
        {data ? (
          <div className="flex flex-col gap-3">
            <div className="text-sm">
              <span className="font-semibold">{data.account.code} · {data.account.name}</span>
              <span className="text-muted-foreground"> — {from} → {to}</span>
            </div>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="px-3 py-2">{t('orva_finance.vat.column.date', 'วันที่')}</th>
                    <th className="px-3 py-2">{t('orva_finance.ledger.column.journal', 'เลขที่สมุดรายวัน')}</th>
                    <th className="px-3 py-2">{t('orva_finance.ledger.column.description', 'รายการ')}</th>
                    <th className="px-3 py-2 text-right">{t('orva_finance.ledger.column.debit', 'เดบิต')}</th>
                    <th className="px-3 py-2 text-right">{t('orva_finance.ledger.column.credit', 'เครดิต')}</th>
                    <th className="px-3 py-2 text-right">{t('orva_finance.ledger.column.balance', 'คงเหลือ')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b bg-muted/20">
                    <td className="px-3 py-2" colSpan={5}>{t('orva_finance.ledger.opening', 'ยอดยกมา')}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(data.openingBalance)}</td>
                  </tr>
                  {data.lines.map((l, i) => (
                    <tr key={`${l.journal_id}-${i}`} className="border-b last:border-b-0">
                      <td className="px-3 py-2">{l.journal_date}</td>
                      <td className="px-3 py-2 font-medium">{l.journal_no ?? '—'}{l.journal_kind === 'reversal' ? ` (${t('orva_finance.ledger.reversal', 'กลับรายการ')})` : ''}</td>
                      <td className="px-3 py-2">{l.description ?? l.memo ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(l.debit) ? fmt(l.debit) : ''}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(l.credit) ? fmt(l.credit) : ''}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(l.balance)}</td>
                    </tr>
                  ))}
                  {data.lines.length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{t('orva_finance.ledger.empty', 'ไม่มีรายการในช่วงวันที่นี้')}</td></tr>
                  ) : null}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30 font-semibold">
                    <td className="px-3 py-2" colSpan={3}>{t('orva_finance.ledger.closing', 'ยอดยกไป')}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(data.totalDebit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(data.totalCredit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums"><span className="orva-ledger-total">{fmt(data.closingBalance)}</span></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ) : null}
      </PageBody>
    </Page>
  )
}
