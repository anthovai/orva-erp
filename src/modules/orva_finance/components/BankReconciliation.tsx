"use client"
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type AccountOption = { id: string; code: string; name: string; account_type: string }
type StatementLine = { id: string; txn_date: string; description: string | null; reference: string | null; amount: string; status: string; journal_line_id: string | null }
type LedgerLine = { journal_line_id: string; journal_no: string | null; journal_date: string; description: string | null; memo: string | null; amount: string; matched: boolean }
type ReconResponse = { statement: StatementLine[]; ledger: LedgerLine[]; summary: { statementBalance: string; ledgerBalance: string; unmatchedStatement: number; unmatchedLedger: number } }

const selectClass =
  'h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'
const fmt = (v: string | number) => Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Parses a bank CSV export (KBank/SCB/BBL style). Header keywords pick the
 * columns; dates accept dd/mm/yyyy (Buddhist or Christian year) and ISO;
 * amounts may come as one signed column or separate withdrawal/deposit columns.
 */
export function parseBankCsv(text: string): Array<{ txnDate: string; description: string | null; reference: string | null; amount: number }> {
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => splitCsv(l))
  if (rows.length < 2) return []
  const header = rows[0].map((h) => h.toLowerCase())
  const find = (...keys: string[]) => header.findIndex((h) => keys.some((k) => h.includes(k)))
  const iDate = find('date', 'วันที่')
  const iDesc = find('description', 'รายละเอียด', 'memo', 'รายการ', 'detail')
  const iRef = find('reference', 'ref', 'อ้างอิง', 'เลขที่')
  const iAmount = find('amount', 'จำนวนเงิน')
  const iOut = find('withdraw', 'debit', 'ถอน', 'จ่าย')
  const iIn = find('deposit', 'credit', 'ฝาก', 'รับ')
  const out: Array<{ txnDate: string; description: string | null; reference: string | null; amount: number }> = []
  for (const cols of rows.slice(1)) {
    const date = normalizeDate(cols[iDate] ?? '')
    if (!date) continue
    let amount = 0
    if (iAmount >= 0) amount = toNumber(cols[iAmount])
    else amount = toNumber(cols[iIn]) - toNumber(cols[iOut])
    if (!amount) continue
    out.push({ txnDate: date, description: iDesc >= 0 ? cols[iDesc] || null : null, reference: iRef >= 0 ? cols[iRef] || null : null, amount: Math.round(amount * 100) / 100 })
  }
  return out
}

function splitCsv(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i++ } else quoted = !quoted }
    else if (ch === ',' && !quoted) { cells.push(cur.trim()); cur = '' }
    else cur += ch
  }
  cells.push(cur.trim())
  return cells
}

function toNumber(raw: string | undefined): number {
  if (!raw) return 0
  const n = Number(raw.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function normalizeDate(raw: string): string | null {
  const s = raw.trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/)
  if (!m) return null
  let year = Number(m[3])
  if (year < 100) year += 2000
  if (year > 2400) year -= 543 // Buddhist era
  return `${year}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`
}

/** กระทบยอดธนาคาร — statement on the left, ledger on the right, match by amount. */
export default function BankReconciliation() {
  const t = useT()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [accountId, setAccountId] = React.useState('')
  const [from, setFrom] = React.useState(() => new Date().toISOString().slice(0, 8) + '01')
  const [to, setTo] = React.useState(() => new Date().toISOString().slice(0, 10))
  const [selectedStatement, setSelectedStatement] = React.useState<string | null>(null)
  const [csv, setCsv] = React.useState('')
  const [importing, setImporting] = React.useState(false)

  const { data: accountsData } = useQuery({
    queryKey: ['orva_finance.accounts.all', scopeVersion],
    queryFn: async () => fetchCrudList<AccountOption>('orva_finance/gl/accounts', { page: 1, pageSize: 100, sortField: 'code', sortDir: 'asc', isActive: true }),
  })
  React.useEffect(() => {
    if (!accountId && accountsData?.items?.length) setAccountId((accountsData.items.find((a) => a.code === '1020') ?? accountsData.items[0]).id)
  }, [accountsData, accountId])

  const { data, isLoading } = useQuery({
    queryKey: ['orva_finance.bank.recon', accountId, from, to, scopeVersion],
    queryFn: async () => readApiResultOrThrow<ReconResponse>(`/api/orva_finance/bank/statements?accountId=${accountId}&from=${from}&to=${to}`),
    enabled: Boolean(accountId),
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['orva_finance.bank.recon'] })

  const importCsv = async () => {
    const lines = parseBankCsv(csv)
    if (!lines.length) { flash(t('orva_finance.bank.flash.parseEmpty', 'อ่านรายการจากไฟล์ไม่ได้ — ต้องมีคอลัมน์วันที่และจำนวนเงิน'), 'error'); return }
    setImporting(true)
    try {
      const res = await fetch('/api/orva_finance/bank/statements', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId, lines }) })
      const body = await res.json().catch(() => null)
      if (!res.ok) { flash(body?.error ?? t('orva_finance.bank.flash.importFailed', 'นำเข้าไม่สำเร็จ'), 'error'); return }
      flash(t('orva_finance.bank.flash.imported', 'นำเข้า {n} รายการ (ซ้ำ {skipped})', { n: String(body.imported), skipped: String(body.skipped) }), 'success')
      setCsv('')
      refresh()
    } finally {
      setImporting(false)
    }
  }

  const act = async (lineId: string, journalLineId: string | null, status?: 'matched' | 'unmatched' | 'excluded') => {
    const res = await fetch('/api/orva_finance/bank/statements/match', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lineId, journalLineId, status }) })
    const body = await res.json().catch(() => null)
    if (!res.ok) { flash(body?.message ?? t('orva_finance.bank.flash.matchFailed', 'จับคู่ไม่สำเร็จ'), 'error'); return }
    setSelectedStatement(null)
    refresh()
  }

  const statement = data?.statement ?? []
  const ledger = data?.ledger ?? []
  const selected = statement.find((s) => s.id === selectedStatement) ?? null
  const candidates = selected ? ledger.filter((l) => !l.matched && Math.abs(Number(l.amount) - Number(selected.amount)) < 0.005) : []
  const diff = data ? Number(data.summary.statementBalance) - Number(data.summary.ledgerBalance) : 0

  return (
    <Page>
      <PageHeader
        title={t('orva_finance.bank.page.title', 'กระทบยอดธนาคาร')}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <select className={`${selectClass} max-w-72`} value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label={t('orva_finance.bank.account', 'บัญชีธนาคาร')}>
              {(accountsData?.items ?? []).filter((a) => a.account_type === 'asset').map((a) => (<option key={a.id} value={a.id}>{a.code} · {a.name}</option>))}
            </select>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
        )}
      />
      <PageBody>
        <div className="flex flex-col gap-6">
          {data ? (
            <div className="grid gap-3 rounded-md border p-4 text-sm md:grid-cols-4">
              <div><div className="text-muted-foreground">{t('orva_finance.bank.summary.statement', 'ยอดตาม statement (ช่วงที่เลือก)')}</div><div className="text-lg font-semibold tabular-nums">{fmt(data.summary.statementBalance)}</div></div>
              <div><div className="text-muted-foreground">{t('orva_finance.bank.summary.ledger', 'ยอดตามบัญชี')}</div><div className="text-lg font-semibold tabular-nums">{fmt(data.summary.ledgerBalance)}</div></div>
              <div><div className="text-muted-foreground">{t('orva_finance.bank.summary.diff', 'ผลต่าง')}</div><div className={`text-lg font-semibold tabular-nums ${Math.abs(diff) < 0.005 ? 'text-primary' : 'text-destructive'}`}>{fmt(diff)}</div></div>
              <div><div className="text-muted-foreground">{t('orva_finance.bank.summary.unmatched', 'ยังไม่จับคู่')}</div><div className="text-lg font-semibold tabular-nums">{data.summary.unmatchedStatement} / {data.summary.unmatchedLedger}</div></div>
            </div>
          ) : null}

          <details className="rounded-md border p-4 text-sm">
            <summary className="cursor-pointer font-medium">{t('orva_finance.bank.import.title', 'นำเข้า statement (CSV จากธนาคาร)')}</summary>
            <p className="mt-2 text-xs text-muted-foreground">{t('orva_finance.bank.import.hint', 'วางเนื้อหา CSV หรือเลือกไฟล์ — ต้องมีหัวคอลัมน์ วันที่ และ จำนวนเงิน (หรือ ถอน/ฝาก แยกกัน) ระบบข้ามรายการซ้ำให้เอง')}</p>
            <div className="mt-2 flex flex-col gap-2">
              <input type="file" accept=".csv,text/csv" className="text-xs" onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then(setCsv) }} />
              <textarea className="min-h-28 w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="Date,Description,Withdrawal,Deposit" />
              <div><Button onClick={importCsv} disabled={!csv.trim() || !accountId || importing}>{t('orva_finance.bank.import.submit', 'นำเข้า')}</Button></div>
            </div>
          </details>

          <div className="grid gap-4 lg:grid-cols-2">
            <section>
              <h2 className="mb-2 text-sm font-semibold">{t('orva_finance.bank.statement.title', 'รายการจากธนาคาร')}</h2>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-muted/50 text-left"><th className="px-2 py-2">{t('orva_finance.vat.column.date', 'วันที่')}</th><th className="px-2 py-2">{t('orva_finance.ledger.column.description', 'รายการ')}</th><th className="px-2 py-2 text-right">{t('orva_finance.bank.column.amount', 'จำนวน')}</th><th className="px-2 py-2">{t('orva_finance.fa.column.status', 'สถานะ')}</th><th /></tr></thead>
                  <tbody>
                    {isLoading ? <tr><td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">…</td></tr> : null}
                    {!isLoading && statement.length === 0 ? <tr><td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">{t('orva_finance.bank.statement.empty', 'ยังไม่มี statement ในช่วงนี้ — นำเข้าจากไฟล์ธนาคาร')}</td></tr> : null}
                    {statement.map((s) => (
                      <tr key={s.id} className={`border-b last:border-b-0 ${selectedStatement === s.id ? 'bg-muted/40' : ''}`}>
                        <td className="px-2 py-2">{s.txn_date}</td>
                        <td className="px-2 py-2">{s.description ?? '—'}{s.reference ? <span className="text-muted-foreground"> · {s.reference}</span> : null}</td>
                        <td className={`px-2 py-2 text-right tabular-nums ${Number(s.amount) < 0 ? 'text-destructive' : ''}`}>{fmt(s.amount)}</td>
                        <td className="px-2 py-2">{s.status === 'matched' ? t('orva_finance.bank.status.matched', 'จับคู่แล้ว') : s.status === 'excluded' ? t('orva_finance.bank.status.excluded', 'ไม่นับ') : t('orva_finance.bank.status.unmatched', 'รอจับคู่')}</td>
                        <td className="px-2 py-2 text-right">
                          {s.status === 'unmatched' ? (
                            <span className="flex justify-end gap-1">
                              <Button size="sm" variant={selectedStatement === s.id ? 'default' : 'outline'} onClick={() => setSelectedStatement(selectedStatement === s.id ? null : s.id)}>{t('orva_finance.bank.actions.match', 'จับคู่')}</Button>
                              <Button size="sm" variant="ghost" onClick={() => act(s.id, null, 'excluded')}>{t('orva_finance.bank.actions.exclude', 'ไม่นับ')}</Button>
                            </span>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => act(s.id, null, 'unmatched')}>{t('orva_finance.bank.actions.undo', 'ยกเลิก')}</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section>
              <h2 className="mb-2 text-sm font-semibold">
                {selected
                  ? t('orva_finance.bank.ledger.candidates', 'รายการในบัญชีที่ยอดตรงกับ {amount}', { amount: fmt(selected.amount) })
                  : t('orva_finance.bank.ledger.title', 'รายการในบัญชี (สมุดธนาคาร)')}
              </h2>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-muted/50 text-left"><th className="px-2 py-2">{t('orva_finance.vat.column.date', 'วันที่')}</th><th className="px-2 py-2">{t('orva_finance.ledger.column.journal', 'เลขที่สมุดรายวัน')}</th><th className="px-2 py-2">{t('orva_finance.ledger.column.description', 'รายการ')}</th><th className="px-2 py-2 text-right">{t('orva_finance.bank.column.amount', 'จำนวน')}</th><th /></tr></thead>
                  <tbody>
                    {(selected ? candidates : ledger).map((l) => (
                      <tr key={l.journal_line_id} className={`border-b last:border-b-0 ${l.matched ? 'text-muted-foreground' : ''}`}>
                        <td className="px-2 py-2">{l.journal_date}</td>
                        <td className="px-2 py-2 font-medium">{l.journal_no ?? '—'}</td>
                        <td className="px-2 py-2">{l.description ?? l.memo ?? '—'}</td>
                        <td className={`px-2 py-2 text-right tabular-nums ${Number(l.amount) < 0 ? 'text-destructive' : ''}`}>{fmt(l.amount)}</td>
                        <td className="px-2 py-2 text-right">
                          {selected && !l.matched ? <Button size="sm" onClick={() => act(selected.id, l.journal_line_id, 'matched')}>{t('orva_finance.bank.actions.pick', 'เลือก')}</Button> : l.matched ? <span className="text-xs">✓</span> : null}
                        </td>
                      </tr>
                    ))}
                    {selected && candidates.length === 0 ? <tr><td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">{t('orva_finance.bank.ledger.noCandidates', 'ไม่มีรายการในบัญชีที่ยอดตรง — อาจยังไม่ได้ลงบัญชี (เช่น ค่าธรรมเนียมธนาคาร) ให้ลงสมุดรายวันก่อนแล้วจับคู่')}</td></tr> : null}
                    {!selected && ledger.length === 0 ? <tr><td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">{t('orva_finance.ledger.empty', 'ไม่มีรายการในช่วงวันที่นี้')}</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
