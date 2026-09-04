"use client"
import * as React from 'react'
import Link from 'next/link'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * The owner's four questions, rendered from /api/orva_finance/home/overview:
 * what money is due in, what came in this month, which filings are next,
 * and what is waiting on somebody. Used by the Orva home screen and by the
 * dashboard widget, so both show the same numbers.
 */
export type HomeOverview = {
  today: string
  month: string
  cashIn: {
    items: Array<{ id: string; ref: string; customer: string | null; dueDate: string | null; daysOverdue: number; remaining: string; total: string }>
    openTotal: string
    overdueTotal: string
    overdueCount: number
  }
  received: {
    total: string; cash: string; wht: string; count: number
    bank: Array<{ code: string; name: string; balance: string }>
    bankTotal: string
  }
  tax: Array<{ kind: 'vat' | 'wht'; period: string; dueDate: string; daysLeft: number; state: 'upcoming' | 'due_soon' | 'overdue'; amount: string; packSentAt: string | null }>
  waiting: {
    quotes: Array<{ id: string; ref: string; customer: string | null; validUntil: string | null; daysLeft: number | null; total: string }>
    unpostedInvoices: number
    draftJournals: number
    unmatchedBankLines: number
    lastMonthPackSent: boolean
    expiringLots: number
    expiredLots: number
    renewingSubscriptions: number
    lapsedSubscriptions: number
  }
}

export const money = (value: string | number) =>
  Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

/** '2026-08' → 'ส.ค. 2569' — the month as the accountant and the RD forms name it. */
export function thaiMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${THAI_MONTHS[m - 1]} ${y + 543}`
}
export function thaiDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${d} ${THAI_MONTHS[m - 1]} ${y + 543}`
}

type Tone = 'good' | 'warn' | 'bad' | undefined
const toneText = (tone: Tone) =>
  tone === 'bad' ? 'text-status-error-text' : tone === 'warn' ? 'text-status-warning-text' : tone === 'good' ? 'text-status-success-text' : ''

function Card({ title, value, tone, href, children }: { title: string; value?: string; tone?: Tone; href: string; children?: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <Link href={href} className="text-sm font-medium hover:underline">{title}</Link>
        {value != null ? <span className={`text-xl font-semibold tabular-nums ${toneText(tone) || 'text-foreground'}`}>{value}</span> : null}
      </div>
      {children}
    </section>
  )
}

function Row({ left, right, sub, tone }: { left: React.ReactNode; right: React.ReactNode; sub?: React.ReactNode; tone?: Tone }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <div className="min-w-0">
        <div className="truncate">{left}</div>
        {sub ? <div className={`truncate text-xs ${toneText(tone) || 'text-muted-foreground'}`}>{sub}</div> : null}
      </div>
      <div className={`shrink-0 tabular-nums ${toneText(tone)}`}>{right}</div>
    </div>
  )
}

export function useHomeOverview(refreshToken?: unknown) {
  const [data, setData] = React.useState<HomeOverview | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    apiCall<HomeOverview>('/api/orva_finance/home/overview')
      .then((res) => {
        if (cancelled) return
        if (!res.ok || !res.result) throw new Error('overview')
        setData(res.result)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [refreshToken])
  return { data, loading, failed }
}

export function FourQuestions({ data, showInvoiceList = true }: { data: HomeOverview; showInvoiceList?: boolean }) {
  const t = useT()
  const overdue = data.cashIn.overdueCount > 0
  const waitingCount = data.waiting.quotes.length + data.waiting.unpostedInvoices + data.waiting.draftJournals + data.waiting.unmatchedBankLines + (data.waiting.lastMonthPackSent ? 0 : 1) + (data.waiting.expiringLots ?? 0) + (data.waiting.expiredLots ?? 0) + (data.waiting.renewingSubscriptions ?? 0) + (data.waiting.lapsedSubscriptions ?? 0)
  const taxTone: Tone = data.tax.some((d) => d.state === 'overdue' && !d.packSentAt) ? 'bad' : data.tax.some((d) => d.state === 'due_soon' && !d.packSentAt) ? 'warn' : undefined

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {/* 1 — money due in */}
      <Card title={t('orva_finance.home.cashIn.title', 'เงินที่จะเข้า')} value={money(data.cashIn.openTotal)} tone={overdue ? 'bad' : undefined} href="/backend/sales/invoices">
        {overdue ? (
          <p className="text-xs text-status-error-text">
            {t('orva_finance.home.cashIn.overdue', 'เกินกำหนด {count} ใบ รวม {amount}')
              .replace('{count}', String(data.cashIn.overdueCount)).replace('{amount}', money(data.cashIn.overdueTotal))}
          </p>
        ) : data.cashIn.items.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('orva_finance.home.cashIn.empty', 'ไม่มีใบแจ้งหนี้ค้างชำระ')}</p>
        ) : null}
        {showInvoiceList ? (
          <div className="flex flex-col gap-1.5">
            {data.cashIn.items.slice(0, 6).map((item) => (
              <Row
                key={item.id}
                left={<Link href={`/backend/sales/invoices/${item.id}`} className="hover:underline">{item.ref}</Link>}
                sub={[item.customer, item.dueDate ? (item.daysOverdue > 0
                  ? t('orva_finance.home.cashIn.daysOverdue', 'เกินกำหนด {days} วัน').replace('{days}', String(item.daysOverdue))
                  : t('orva_finance.home.cashIn.dueOn', 'ครบกำหนด {date}').replace('{date}', thaiDate(item.dueDate))) : null].filter(Boolean).join(' · ')}
                right={money(item.remaining)}
                tone={item.daysOverdue > 0 ? 'bad' : undefined}
              />
            ))}
          </div>
        ) : null}
      </Card>

      {/* 2 — money received this month */}
      <Card
        title={t('orva_finance.home.received.title', 'เงินเข้าเดือน {month}').replace('{month}', thaiMonth(data.month))}
        value={money(data.received.cash)}
        tone={Number(data.received.cash) > 0 ? 'good' : undefined}
        href="/backend/ar/receipts"
      >
        <div className="flex flex-col gap-1.5">
          <Row
            left={t('orva_finance.home.received.receipts', 'รับชำระ {count} รายการ').replace('{count}', String(data.received.count))}
            sub={Number(data.received.wht) > 0
              ? t('orva_finance.home.received.wht', 'ลูกค้าหัก ณ ที่จ่ายไว้ {amount} (เครดิตภาษีของเรา)').replace('{amount}', money(data.received.wht))
              : undefined}
            right={money(data.received.total)}
          />
          {data.received.bank.filter((b) => Number(b.balance) !== 0).map((b) => (
            <Row key={b.code} left={<Link href="/backend/bank/reconciliation" className="hover:underline">{b.name}</Link>} sub={t('orva_finance.home.received.balance', 'ยอดตามบัญชี ณ วันนี้')} right={money(b.balance)} />
          ))}
        </div>
      </Card>

      {/* 3 — tax coming up */}
      <Card title={t('orva_finance.home.tax.title', 'ภาษีที่ใกล้ถึงกำหนด')} tone={taxTone} href="/backend/reports/month-pack">
        <div className="flex flex-col gap-1.5">
          {data.tax.map((d) => {
            const label = d.kind === 'vat' ? t('orva_finance.home.tax.vat', 'ภ.พ.30 เดือน {month}') : t('orva_finance.home.tax.wht', 'ภ.ง.ด.3/53 เดือน {month}')
            const when = d.state === 'overdue'
              ? t('orva_finance.home.tax.overdue', 'เลยกำหนด {days} วัน (ยื่นกระดาษ {date})').replace('{days}', String(-d.daysLeft))
              : t('orva_finance.home.tax.due', 'ยื่นภายใน {date} (อีก {days} วัน)').replace('{days}', String(d.daysLeft))
            const sub = d.packSentAt
              ? t('orva_finance.home.tax.packSent', 'ส่งชุดปิดเดือนให้สำนักงานบัญชีแล้ว {date}').replace('{date}', thaiDate(d.packSentAt.slice(0, 10)))
              : when.replace('{date}', thaiDate(d.dueDate))
            return (
              <Row
                key={`${d.kind}-${d.period}`}
                left={<Link href={d.kind === 'vat' ? '/backend/reports/vat' : '/backend/reports/wht'} className="hover:underline">{label.replace('{month}', thaiMonth(d.period))}</Link>}
                sub={sub}
                right={Number(d.amount) === 0 ? t('orva_finance.home.tax.nothing', 'ไม่มียอด') : money(d.amount)}
                tone={d.packSentAt ? 'good' : d.state === 'overdue' ? 'bad' : d.state === 'due_soon' ? 'warn' : undefined}
              />
            )
          })}
          <p className="text-xs text-muted-foreground">{t('orva_finance.home.tax.efiling', 'ยื่นออนไลน์ได้ถึง 8 วันหลังกำหนดกระดาษ')}</p>
        </div>
      </Card>

      {/* 4 — waiting on someone */}
      <Card title={t('orva_finance.home.waiting.title', 'เอกสารที่รอ')} value={String(waitingCount)} tone={waitingCount > 0 ? 'warn' : 'good'} href="/backend/sales/quotes">
        <div className="flex flex-col gap-1.5">
          {data.waiting.quotes.slice(0, 4).map((q) => (
            <Row
              key={q.id}
              left={<Link href={`/backend/sales/quotes/${q.id}`} className="hover:underline">{q.ref}</Link>}
              sub={[q.customer, q.daysLeft == null ? null : q.daysLeft < 0
                ? t('orva_finance.home.waiting.quoteExpired', 'หมดอายุแล้ว {days} วัน').replace('{days}', String(-q.daysLeft))
                : t('orva_finance.home.waiting.quoteValid', 'ใบเสนอราคาหมดอายุในอีก {days} วัน').replace('{days}', String(q.daysLeft))].filter(Boolean).join(' · ')}
              right={money(q.total)}
              tone={q.daysLeft != null && q.daysLeft < 0 ? 'bad' : q.daysLeft != null && q.daysLeft <= 7 ? 'warn' : undefined}
            />
          ))}
          {data.waiting.unpostedInvoices > 0 ? (
            <Row left={<Link href="/backend/ar/posting" className="hover:underline">{t('orva_finance.home.waiting.unposted', 'ใบแจ้งหนี้ยังไม่ลงบัญชี')}</Link>} right={String(data.waiting.unpostedInvoices)} tone="warn" />
          ) : null}
          {data.waiting.draftJournals > 0 ? (
            <Row left={<Link href="/backend/gl/journals" className="hover:underline">{t('orva_finance.home.waiting.drafts', 'สมุดรายวันฉบับร่างเดือนนี้')}</Link>} right={String(data.waiting.draftJournals)} tone="warn" />
          ) : null}
          {data.waiting.unmatchedBankLines > 0 ? (
            <Row left={<Link href="/backend/bank/reconciliation" className="hover:underline">{t('orva_finance.home.waiting.bank', 'รายการธนาคารยังไม่กระทบยอด')}</Link>} right={String(data.waiting.unmatchedBankLines)} tone="warn" />
          ) : null}
          {(data.waiting.expiredLots ?? 0) > 0 ? (
            <Row left={<Link href="/backend/stock/valuation" className="hover:underline">{t('orva_finance.home.waiting.expiredLots', 'ล็อตสินค้าหมดอายุแล้วแต่ยังมีของค้าง')}</Link>} right={String(data.waiting.expiredLots)} tone="bad" />
          ) : null}
          {(data.waiting.expiringLots ?? 0) > 0 ? (
            <Row left={<Link href="/backend/stock/valuation" className="hover:underline">{t('orva_finance.home.waiting.expiringLots', 'ล็อตสินค้าใกล้หมดอายุใน 90 วัน')}</Link>} right={String(data.waiting.expiringLots)} tone="warn" />
          ) : null}
          {(data.waiting.lapsedSubscriptions ?? 0) > 0 ? (
            <Row left={<Link href="/backend/support/subscriptions" className="hover:underline">{t('orva_finance.home.waiting.lapsedSubscriptions', 'ไลเซนส์/โดเมนเลยกำหนดต่ออายุ')}</Link>} right={String(data.waiting.lapsedSubscriptions)} tone="bad" />
          ) : null}
          {(data.waiting.renewingSubscriptions ?? 0) > 0 ? (
            <Row left={<Link href="/backend/support/subscriptions" className="hover:underline">{t('orva_finance.home.waiting.renewingSubscriptions', 'ไลเซนส์/โดเมนต่ออายุใน 30 วัน')}</Link>} right={String(data.waiting.renewingSubscriptions)} tone="warn" />
          ) : null}
          {!data.waiting.lastMonthPackSent ? (
            <Row left={<Link href="/backend/reports/month-pack" className="hover:underline">{t('orva_finance.home.waiting.pack', 'ชุดปิดเดือนที่แล้วยังไม่ส่งสำนักงานบัญชี')}</Link>} right="1" tone="warn" />
          ) : null}
          {waitingCount === 0 ? <p className="text-xs text-muted-foreground">{t('orva_finance.home.waiting.empty', 'ไม่มีอะไรค้าง')}</p> : null}
        </div>
      </Card>
    </div>
  )
}

/** Loading + error wrapper around FourQuestions. */
export function FourQuestionsPanel({ refreshToken, showInvoiceList }: { refreshToken?: unknown; showInvoiceList?: boolean }) {
  const t = useT()
  const { data, loading, failed } = useHomeOverview(refreshToken)
  if (loading) return <div className="flex items-center justify-center py-8"><Spinner /></div>
  if (failed || !data) return <p className="py-6 text-center text-sm text-muted-foreground">{t('orva_finance.home.unavailable', 'ยังดึงตัวเลขไม่ได้ในขณะนี้')}</p>
  return <FourQuestions data={data} showInvoiceList={showInvoiceList} />
}
