/**
 * Pure aging math for AP/AR open items. Days overdue are measured from the
 * item's due date (falling back to its document date) against an as-of date;
 * items not yet due sit in the 'current' bucket.
 */
export const AGING_BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const
export type AgingBucket = (typeof AGING_BUCKETS)[number]

export type AgingItemInput = {
  ref: string
  partyName?: string | null
  dueDate?: string | null
  documentDate?: string | null
  remaining: number | string
}

export type AgingRow = {
  ref: string
  partyName: string | null
  dueDate: string | null
  daysOverdue: number
  bucket: AgingBucket
  remaining: string
}

export type AgingReport = {
  rows: AgingRow[]
  totals: Record<AgingBucket, string> & { total: string }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function daysOverdue(asOf: string, dueDate: string): number {
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`)
  const dueMs = Date.parse(`${dueDate}T00:00:00Z`)
  if (!Number.isFinite(asOfMs) || !Number.isFinite(dueMs)) return 0
  return Math.floor((asOfMs - dueMs) / MS_PER_DAY)
}

export function agingBucket(days: number): AgingBucket {
  if (days <= 0) return 'current'
  if (days <= 30) return 'd1_30'
  if (days <= 60) return 'd31_60'
  if (days <= 90) return 'd61_90'
  return 'd90_plus'
}

export function buildAging(asOf: string, items: AgingItemInput[]): AgingReport {
  const totals: Record<string, number> = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 }
  const rows: AgingRow[] = []
  for (const item of items) {
    const remaining = Number(item.remaining) || 0
    if (remaining <= 0.00005) continue
    const effectiveDue = item.dueDate ?? item.documentDate ?? null
    const days = effectiveDue ? daysOverdue(asOf, effectiveDue) : 0
    const bucket = agingBucket(days)
    totals[bucket] += remaining
    totals.total += remaining
    rows.push({
      ref: item.ref,
      partyName: item.partyName ?? null,
      dueDate: effectiveDue,
      daysOverdue: Math.max(0, days),
      bucket,
      remaining: remaining.toFixed(4),
    })
  }
  rows.sort((a, b) => b.daysOverdue - a.daysOverdue || a.ref.localeCompare(b.ref))
  return {
    rows,
    totals: {
      current: totals.current.toFixed(4),
      d1_30: totals.d1_30.toFixed(4),
      d31_60: totals.d31_60.toFixed(4),
      d61_90: totals.d61_90.toFixed(4),
      d90_plus: totals.d90_plus.toFixed(4),
      total: totals.total.toFixed(4),
    },
  }
}
