"use client"
import * as React from 'react'
import Link from 'next/link'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import {
  CalendarClock,
  FilePlus2,
  Hourglass,
  LayoutGrid,
  PackageCheck,
  ReceiptText,
  UserPlus,
  Wallet,
} from 'lucide-react'
import {
  FourQuestions,
  money,
  thaiMonth,
  useHomeOverview,
  type HomeOverview,
} from '@/modules/orva_finance/components/FourQuestions'
import { OrvaPageHeader } from '@/components/orva/PageHeader'
import { StatCard, StatStrip } from '@/components/orva/StatStrip'

/**
 * The Orva home: the owner's first minute of the day, not a widget grid.
 *
 * Four questions, in the order a one-person Thai company asks them (spec
 * .ai/specs/2026-09-03-orva-for-kaiser-klowns-operating-model.md): what money
 * is due in, what came in this month, which tax filings are next, and what is
 * waiting on somebody — then the shortcuts to start new work. The customizable
 * widget grid still exists one level down at /backend/dashboard.
 *
 * The reference design leads with a strip of stat cards, which this now does.
 * What it does NOT take from the reference is the content: a mockup's numbers
 * are decoration, and a dashboard that opens with an invented revenue chart is
 * worse than one that opens with four true figures. Every number in the strip
 * is read off the same overview the panels below already loaded — one fetch,
 * two readers, no figure that exists only to fill a card.
 */
export function OrvaHomeScreen() {
  const t = useT()
  const locale = useLocale()
  const { data, loading, failed } = useHomeOverview()

  // Same locale the rest of the app renders in; Thai gets the Buddhist year.
  const today = new Intl.DateTimeFormat(locale === 'th' ? 'th-TH-u-ca-buddhist' : locale, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date())

  const shortcuts = [
    { href: '/backend/sales/documents/create', icon: FilePlus2, label: t('orva.home.create.quote', 'สร้างเอกสารการขาย') },
    { href: '/backend/customers/companies/create', icon: UserPlus, label: t('orva.home.create.customer', 'เพิ่มลูกค้า') },
    { href: '/backend/ap/bills/create', icon: ReceiptText, label: t('orva.home.create.bill', 'บันทึกบิลผู้ขาย') },
    { href: '/backend/reports/month-pack', icon: PackageCheck, label: t('orva.home.open.monthPack', 'ชุดปิดเดือนส่งสำนักงานบัญชี') },
  ]

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <OrvaPageHeader
        kicker={today}
        title={t('orva.home.title', 'วันนี้ของกิจการคุณ')}
        actions={(
          <Button asChild variant="ghost" size="sm">
            <Link href="/backend/dashboard">
              <LayoutGrid className="size-4" />
              {t('orva.home.widgetDashboard', 'แดชบอร์ดวิดเจ็ต')}
            </Link>
          </Button>
        )}
      />

      {loading ? (
        <div className="flex items-center justify-center py-10"><Spinner /></div>
      ) : failed || !data ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t('orva_finance.home.unavailable', 'ยังดึงตัวเลขไม่ได้ในขณะนี้')}
        </p>
      ) : (
        <>
          <HomeStats data={data} />
          <FourQuestions data={data} hideCardValues />
        </>
      )}

      <section className="rounded-xl border bg-card" aria-label={t('orva.home.create.title', 'เริ่มงานใหม่')}>
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{t('orva.home.create.title', 'เริ่มงานใหม่')}</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
          {shortcuts.map(({ href, icon: Icon, label }) => (
            <Link
              key={href}
              href={href}
              className="flex flex-col items-start gap-2 rounded-lg border p-4 transition-colors hover:border-primary hover:bg-muted/40"
            >
              <Icon className="size-5 text-primary" />
              <span className="text-sm font-medium">{label}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

/** The four figures, all of them read off the overview the page already has. */
function HomeStats({ data }: { data: HomeOverview }) {
  const t = useT()

  const waitingCount =
    data.waiting.quotes.length
    + data.waiting.unpostedInvoices
    + data.waiting.draftJournals
    + data.waiting.unmatchedBankLines
    + (data.waiting.lastMonthPackSent ? 0 : 1)
    + (data.waiting.acceptedAwaitingInstallment?.length ?? 0)
    + (data.waiting.billingBehindWork?.length ?? 0)
    + (data.waiting.periodsToClose?.length ?? 0)

  // The filing that actually comes first, not the first one in the list.
  const nextTax = [...data.tax].sort((a, b) => a.daysLeft - b.daysLeft)[0]

  return (
    <StatStrip>
      <StatCard
        label={t('orva.home.stat.due', 'เงินรอเข้า')}
        value={money(data.cashIn.openTotal)}
        tone={data.cashIn.overdueCount > 0 ? 'bad' : 'neutral'}
        icon={<Wallet className="size-4" aria-hidden />}
        href="/backend/sales/invoices"
        note={data.cashIn.overdueCount > 0
          ? t('orva.home.stat.dueOverdue', 'เกินกำหนด {count} ใบ · {amount}', {
            count: data.cashIn.overdueCount, amount: money(data.cashIn.overdueTotal),
          })
          : t('orva.home.stat.dueNone', 'ไม่มีใบที่เกินกำหนด')}
      />
      <StatCard
        label={t('orva.home.stat.received', 'รับมาเดือนนี้')}
        value={money(data.received.cash)}
        tone="good"
        icon={<ReceiptText className="size-4" aria-hidden />}
        href="/backend/ar/receipts"
        note={Number(data.received.wht) > 0
          ? t('orva.home.stat.receivedWht', '{count} ใบเสร็จ · ลูกค้าหักไว้ {wht}', {
            count: data.received.count, wht: money(data.received.wht),
          })
          : t('orva.home.stat.receivedCount', '{count} ใบเสร็จ · {month}', {
            count: data.received.count, month: thaiMonth(data.month),
          })}
      />
      <StatCard
        label={t('orva.home.stat.waiting', 'ค้างที่คน')}
        value={waitingCount}
        tone={waitingCount > 0 ? 'warn' : 'good'}
        icon={<Hourglass className="size-4" aria-hidden />}
        note={waitingCount > 0
          ? t('orva.home.stat.waitingNote', 'รายการที่รอใครสักคนขยับ')
          : t('orva.home.stat.waitingNone', 'ไม่มีอะไรค้าง')}
      />
      <StatCard
        label={t('orva.home.stat.tax', 'ภาษีงวดถัดไป')}
        value={nextTax ? money(nextTax.amount) : '—'}
        tone={nextTax?.state === 'overdue' ? 'bad' : nextTax?.state === 'due_soon' ? 'warn' : 'neutral'}
        icon={<CalendarClock className="size-4" aria-hidden />}
        href="/backend/reports/vat"
        // `daysLeft` goes negative once a deadline passes, so a filing 26 days
        // late read as "in -26 days". Past is said as past.
        note={!nextTax
          ? t('orva.home.stat.taxNone', 'ไม่มีงวดที่ต้องยื่น')
          : nextTax.daysLeft < 0
            ? t('orva.home.stat.taxOverdue', '{period} · เลยกำหนดมา {days} วัน', {
              period: thaiMonth(nextTax.period), days: Math.abs(nextTax.daysLeft),
            })
            : t('orva.home.stat.taxDue', '{period} · อีก {days} วัน', {
              period: thaiMonth(nextTax.period), days: nextTax.daysLeft,
            })}
      />
    </StatStrip>
  )
}
