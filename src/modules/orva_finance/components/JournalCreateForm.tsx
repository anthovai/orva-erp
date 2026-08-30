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

const LIST_HREF = '/backend/gl/journals'

type AccountOption = { id: string; code: string; name: string }
type PeriodOption = { id: string; code: string; status: string; starts_on: string; ends_on: string }

type LineDraft = {
  key: number
  accountId: string
  debit: string
  credit: string
  description: string
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'

function newLine(key: number): LineDraft {
  return { key, accountId: '', debit: '', credit: '', description: '' }
}

export default function JournalCreateForm() {
  const t = useT()
  const router = useRouter()
  const [periodId, setPeriodId] = React.useState('')
  const [journalDate, setJournalDate] = React.useState(() => new Date().toISOString().slice(0, 10))
  const [currencyCode, setCurrencyCode] = React.useState('THB')
  const [memo, setMemo] = React.useState('')
  const [lines, setLines] = React.useState<LineDraft[]>([newLine(1), newLine(2)])
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const nextKey = React.useRef(3)

  const { data: accountsData } = useQuery({
    queryKey: ['orva_finance.accounts.options'],
    queryFn: async () =>
      fetchCrudList<AccountOption>('orva_finance/gl/accounts', {
        page: 1, pageSize: 100, sortField: 'code', sortDir: 'asc', isActive: true,
      }),
  })
  const { data: periodsData } = useQuery({
    queryKey: ['orva_finance.periods.options'],
    queryFn: async () =>
      fetchCrudList<PeriodOption>('orva_finance/gl/periods', {
        page: 1, pageSize: 100, sortField: 'starts_on', sortDir: 'desc', status: 'open',
      }),
  })

  const accounts = accountsData?.items ?? []
  const periods = periodsData?.items ?? []

  const updateLine = (key: number, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }
  const addLine = () => setLines((prev) => [...prev, newLine(nextKey.current++)])
  const removeLine = (key: number) => setLines((prev) => (prev.length > 2 ? prev.filter((l) => l.key !== key) : prev))

  const totals = React.useMemo(() => {
    let debit = 0
    let credit = 0
    for (const line of lines) {
      debit += Number(line.debit) || 0
      credit += Number(line.credit) || 0
    }
    return { debit, credit, balanced: debit > 0 && Math.abs(debit - credit) < 0.00005 }
  }, [lines])

  const linesValid = lines.every((line) => {
    const debit = Number(line.debit) || 0
    const credit = Number(line.credit) || 0
    return line.accountId && debit >= 0 && credit >= 0 && !(debit > 0 && credit > 0) && (debit > 0 || credit > 0)
  })
  const canSubmit = Boolean(periodId && journalDate && lines.length >= 2 && linesValid && totals.balanced && !submitting)

  const submit = async () => {
    setError(null)
    setSubmitting(true)
    try {
      await createCrud('orva_finance/gl/journals', {
        periodId,
        journalDate,
        currencyCode,
        memo: memo || null,
        lines: lines.map((line) => ({
          accountId: line.accountId,
          debit: Number(line.debit) || 0,
          credit: Number(line.credit) || 0,
          description: line.description || null,
        })),
      })
      flash(t('orva_finance.journals.flash.created', 'Draft journal created'), 'success')
      router.push(LIST_HREF)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('orva_finance.journals.form.error.create', 'Failed to create journal'))
      setSubmitting(false)
    }
  }

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <Page>
      <PageHeader
        title={t('orva_finance.journals.form.create.title', 'Create journal')}
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href={LIST_HREF}>{t('orva_finance.form.cancel', 'Cancel')}</Link>
            </Button>
            <Button onClick={submit} disabled={!canSubmit}>
              {t('orva_finance.journals.form.create.submit', 'Create draft')}
            </Button>
          </div>
        )}
      />
      <PageBody>
        <div className="flex flex-col gap-6">
          {error ? <div className="text-sm text-destructive">{error}</div> : null}

          <div className="grid gap-4 md:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('orva_finance.periods.column.code', 'Period')} *</span>
              <select className={selectClass} value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
                <option value="">{t('orva_finance.journals.form.selectPeriod', '— select open period —')}</option>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>{p.code} ({p.starts_on} → {p.ends_on})</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('orva_finance.journals.column.date', 'Date')} *</span>
              <Input type="date" value={journalDate} onChange={(e) => setJournalDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('orva_finance.journals.form.currency', 'Currency')}</span>
              <Input value={currencyCode} maxLength={3} onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())} />
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
                  <th className="px-3 py-2 min-w-56">{t('orva_finance.journals.form.account', 'Account')}</th>
                  <th className="px-3 py-2 w-36 text-right">{t('orva_finance.journals.column.debit', 'Debit')}</th>
                  <th className="px-3 py-2 w-36 text-right">{t('orva_finance.journals.column.credit', 'Credit')}</th>
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
                        value={line.accountId}
                        onChange={(e) => updateLine(line.key, { accountId: e.target.value })}
                      >
                        <option value="">{t('orva_finance.journals.form.selectAccount', '— select account —')}</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number" min="0" step="0.01" className="text-right tabular-nums"
                        value={line.debit}
                        onChange={(e) => updateLine(line.key, { debit: e.target.value, ...(e.target.value ? { credit: '' } : {}) })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number" min="0" step="0.01" className="text-right tabular-nums"
                        value={line.credit}
                        onChange={(e) => updateLine(line.key, { credit: e.target.value, ...(e.target.value ? { debit: '' } : {}) })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        value={line.description}
                        onChange={(e) => updateLine(line.key, { description: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        variant="ghost" size="sm" disabled={lines.length <= 2}
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
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.debit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.credit)}</td>
                  <td className="px-3 py-2" colSpan={2}>
                    {totals.balanced ? (
                      <span className="text-xs text-muted-foreground">
                        {t('orva_finance.journals.form.balanced', 'Balanced')} ✓
                      </span>
                    ) : (
                      <span className="text-xs text-destructive">
                        {t('orva_finance.journals.form.unbalanced', 'Out of balance')}: {fmt(Math.abs(totals.debit - totals.credit))}
                      </span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-xs text-muted-foreground max-w-prose">
            {t(
              'orva_finance.journals.form.hint',
              'The journal is created as a draft. Post it from the journals list once reviewed — posted journals are immutable.',
            )}
          </p>
        </div>
      </PageBody>
    </Page>
  )
}
