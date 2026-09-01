"use client"
import * as React from 'react'
import Link from 'next/link'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { FilePlus2, UserPlus, ReceiptText, BarChart3, LayoutGrid, ArrowRight } from 'lucide-react'

/**
 * The Orva home: the owner's first minute of the day, not a widget grid.
 *
 * Three questions, in the order a Thai SME owner actually asks them —
 * เงินเป็นยังไง (the month's money, closed with the double ledger rule),
 * มีงานอะไรค้าง (latest quotations, one click from their documents), and
 * จะเริ่มงานใหม่ตรงไหน (create shortcuts). The customizable widget grid
 * still exists, one level down at /backend/dashboard.
 *
 * Sections degrade independently: a user without finance features simply
 * does not see the money strip — no error card, no empty shell.
 */

type StatementsResponse = { pl?: { totalIncome?: string; netProfit?: string } }
type AgingResponse = { ar?: { totals?: { total?: string } }; ap?: { totals?: { total?: string } } }
type QuoteSource = { id: string; number: string; issueDate: string | null; customerName: string | null }

const thb = (value: number) =>
  value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function monthRange(): { from: string; to: string } {
  const now = new Date()
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const to = now.toISOString().slice(0, 10)
  return { from, to }
}

function useHomeData() {
  const [figures, setFigures] = React.useState<{ income: number; net: number; ar: number; ap: number } | null>(null)
  const [quotes, setQuotes] = React.useState<QuoteSource[] | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    const { from, to } = monthRange()
    void Promise.allSettled([
      apiCall<StatementsResponse>(`/api/orva_finance/gl/reports/statements?from=${from}&to=${to}`),
      apiCall<AgingResponse>('/api/orva_finance/reports/aging'),
      apiCall<{ sources?: QuoteSource[] }>('/api/orva_documents/preview?type=quotation'),
    ]).then(([statements, aging, preview]) => {
      if (cancelled) return
      if (statements.status === 'fulfilled' && statements.value.ok && aging.status === 'fulfilled' && aging.value.ok) {
        setFigures({
          income: Number(statements.value.result?.pl?.totalIncome ?? 0),
          net: Number(statements.value.result?.pl?.netProfit ?? 0),
          ar: Number(aging.value.result?.ar?.totals?.total ?? 0),
          ap: Number(aging.value.result?.ap?.totals?.total ?? 0),
        })
      }
      if (preview.status === 'fulfilled' && preview.value.ok) {
        setQuotes((preview.value.result?.sources ?? []).slice(0, 5))
      }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  return { figures, quotes, loading }
}

function MoneyFigure({ label, value, emphasize }: { label: string; value: number; emphasize?: boolean }) {
  return (
    <div className="min-w-40 flex-1 rounded-lg border bg-card p-4">
      <p className="orva-kicker">{label}</p>
      <p className={`mt-2 w-fit text-2xl font-semibold tabular-nums ${emphasize ? 'orva-ledger-total' : ''} ${value < 0 ? 'text-destructive' : ''}`}>
        {thb(value)}
      </p>
    </div>
  )
}

export function OrvaHomeScreen() {
  const t = useT()
  const { figures, quotes, loading } = useHomeData()

  const today = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date())

  const shortcuts = [
    { href: '/backend/sales/documents/create', icon: FilePlus2, label: t('orva.home.create.quote', 'สร้างเอกสารการขาย') },
    { href: '/backend/customers/companies/create', icon: UserPlus, label: t('orva.home.create.customer', 'เพิ่มลูกค้า') },
    { href: '/backend/ap/bills/create', icon: ReceiptText, label: t('orva.home.create.bill', 'บันทึกบิลผู้ขาย') },
    { href: '/backend/gl/statements', icon: BarChart3, label: t('orva.home.open.statements', 'ดูงบการเงิน') },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="orva-kicker">{today}</p>
          <h1 className="mt-1 text-2xl font-semibold">{t('orva.home.title', 'วันนี้ของกิจการคุณ')}</h1>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/backend/dashboard">
            <LayoutGrid className="size-4" />
            {t('orva.home.widgetDashboard', 'แดชบอร์ดวิดเจ็ต')}
          </Link>
        </Button>
      </header>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <>
          {figures ? (
            <section aria-label={t('orva.home.money.title', 'การเงินเดือนนี้')}>
              <div className="flex flex-wrap gap-3">
                <MoneyFigure label={t('orva.home.money.income', 'รายได้เดือนนี้')} value={figures.income} />
                <MoneyFigure label={t('orva.home.money.net', 'กำไรสุทธิ')} value={figures.net} emphasize />
                <MoneyFigure label={t('orva.home.money.ar', 'ลูกหนี้ค้างรับ')} value={figures.ar} />
                <MoneyFigure label={t('orva.home.money.ap', 'เจ้าหนี้ค้างจ่าย')} value={figures.ap} />
              </div>
            </section>
          ) : null}

          <section className="grid gap-6 md:grid-cols-2">
            <div className="rounded-lg border bg-card">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h2 className="text-sm font-semibold">{t('orva.home.quotes.title', 'ใบเสนอราคาล่าสุด')}</h2>
                <Link href="/backend/sales/quotes" className="text-xs text-primary hover:underline">
                  {t('orva.home.quotes.all', 'ดูทั้งหมด')}
                </Link>
              </div>
              {quotes && quotes.length > 0 ? (
                <ul className="divide-y">
                  {quotes.map((quote) => (
                    <li key={quote.id}>
                      <Link
                        href={`/backend/sales/quotes/${quote.id}`}
                        className="group flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{quote.number}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {quote.customerName ?? t('orva.home.quotes.noCustomer', 'ยังไม่ระบุลูกค้า')}
                            {quote.issueDate ? ` · ${quote.issueDate}` : ''}
                          </span>
                        </span>
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {t('orva.home.quotes.empty', 'ยังไม่มีใบเสนอราคา — เริ่มใบแรกได้จากทางลัดด้านขวา')}
                </p>
              )}
            </div>

            <div className="rounded-lg border bg-card">
              <div className="border-b px-4 py-3">
                <h2 className="text-sm font-semibold">{t('orva.home.create.title', 'เริ่มงานใหม่')}</h2>
              </div>
              <div className="grid grid-cols-2 gap-3 p-4">
                {shortcuts.map(({ href, icon: Icon, label }) => (
                  <Link
                    key={href}
                    href={href}
                    className="flex flex-col items-start gap-2 rounded-md border p-4 transition-colors hover:border-primary hover:bg-muted/40"
                  >
                    <Icon className="size-5 text-primary" />
                    <span className="text-sm font-medium">{label}</span>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
