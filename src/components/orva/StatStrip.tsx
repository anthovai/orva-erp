"use client"
import * as React from 'react'
import Link from 'next/link'
import { cn } from '@open-mercato/shared/lib/utils'

/**
 * The row of figures a business opens its own system to see.
 *
 * The reference design leads the dashboard with four stat cards, and that is
 * the right shape — but the numbers in a mockup are decoration (248 employees,
 * ฿2,580,000 revenue) and this company has neither. So the shape is taken and
 * the content is not: every figure here comes from the home overview the page
 * already loads, which means the strip states facts this business can act on
 * and never invents one to fill a card.
 *
 * A card with no number does not render as a zero dressed up as news; the
 * caller decides whether the fact exists, and a `note` says what the figure
 * means rather than padding it with a percentage nobody measured.
 */

export type StatTone = 'neutral' | 'good' | 'warn' | 'bad'

// The status tokens already carry their own dark-mode values, and the panels
// below this strip speak the same four tones — a card that invented its own
// amber would drift from them the first time either changed.
const TONES: Record<StatTone, string> = {
  neutral: 'text-foreground',
  good: 'text-status-success-text',
  warn: 'text-status-warning-text',
  bad: 'text-status-error-text',
}

export type StatCardProps = {
  label: string
  value: React.ReactNode
  note?: React.ReactNode
  tone?: StatTone
  icon?: React.ReactNode
  href?: string
}

export function StatCard({ label, value, note, tone = 'neutral', icon, href }: StatCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="orva-kicker">{label}</span>
        {icon ? (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </span>
        ) : null}
      </div>
      <div className={cn('mt-3 text-2xl font-semibold tabular-nums tracking-tight', TONES[tone])}>{value}</div>
      {note ? <div className="mt-1 text-xs leading-5 text-muted-foreground">{note}</div> : null}
    </>
  )

  const shell = 'rounded-xl border bg-card p-4'
  if (!href) return <div className={shell}>{body}</div>
  return (
    <Link href={href} className={cn(shell, 'block transition-colors hover:border-primary/40 hover:bg-muted/30')}>
      {body}
    </Link>
  )
}

export function StatStrip({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
}
