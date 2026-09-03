"use client"
import * as React from 'react'
import Link from 'next/link'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { FilePlus2, UserPlus, ReceiptText, PackageCheck, LayoutGrid } from 'lucide-react'
import { FourQuestionsPanel } from '@/modules/orva_finance/components/FourQuestions'

/**
 * The Orva home: the owner's first minute of the day, not a widget grid.
 *
 * Four questions, in the order a one-person Thai company asks them (spec
 * .ai/specs/2026-09-03-orva-for-kaiser-klowns-operating-model.md): what
 * money is due in, what came in this month, which tax filings are next, and
 * what is waiting on somebody — then the shortcuts to start new work. The
 * customizable widget grid still exists one level down at /backend/dashboard.
 */
export function OrvaHomeScreen() {
  const t = useT()
  const today = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date())

  const shortcuts = [
    { href: '/backend/sales/documents/create', icon: FilePlus2, label: t('orva.home.create.quote', 'สร้างเอกสารการขาย') },
    { href: '/backend/customers/companies/create', icon: UserPlus, label: t('orva.home.create.customer', 'เพิ่มลูกค้า') },
    { href: '/backend/ap/bills/create', icon: ReceiptText, label: t('orva.home.create.bill', 'บันทึกบิลผู้ขาย') },
    { href: '/backend/reports/month-pack', icon: PackageCheck, label: t('orva.home.open.monthPack', 'ชุดปิดเดือนส่งสำนักงานบัญชี') },
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

      <FourQuestionsPanel />

      <section className="rounded-lg border bg-card" aria-label={t('orva.home.create.title', 'เริ่มงานใหม่')}>
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{t('orva.home.create.title', 'เริ่มงานใหม่')}</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
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
      </section>
    </div>
  )
}
