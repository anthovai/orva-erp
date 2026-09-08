import type { LateLine } from './summary'

/**
 * Which late lines deserve a notification today, as a pure decision.
 *
 * Lifted out of the worker so the rule can be tested without a queue, a
 * database or a clock — the same split `orva_finance/lib/overdueScan.ts`
 * makes, for the same reason.
 *
 * The rule is deliberately quiet. A line that has been late for a month must
 * not produce thirty notifications, so it speaks on a widening cadence: the
 * first day, then day three, then weekly. That keeps a real problem visible
 * without training the owner to dismiss the badge on sight.
 */
export const NOTIFY_ON_DAYS = [1, 3] as const

export function shouldNotifyToday(daysLate: number): boolean {
  if (daysLate < 1) return false
  if ((NOTIFY_ON_DAYS as readonly number[]).includes(daysLate)) return true
  // Weekly after the first week: 7, 14, 21 …
  return daysLate >= 7 && daysLate % 7 === 0
}

/**
 * One notification per line per day. The date is in the key, so a retry, a
 * second tick or a re-run cannot nag twice for the same line.
 */
export function lateLineGroupKey(lineId: string, today: string): string {
  return `orva_purchasing.line_late:${lineId}:${today}`
}

export type LateNotification = {
  line: LateLine
  groupKey: string
  bodyVariables: Record<string, string>
}

export function lateLinesToNotify(lines: LateLine[], today: string): LateNotification[] {
  return lines
    .filter((line) => shouldNotifyToday(line.daysLate))
    .map((line) => ({
      line,
      groupKey: lateLineGroupKey(line.lineId, today),
      bodyVariables: {
        description: line.description,
        vendor: line.vendorName,
        days: String(line.daysLate),
        remaining: line.remainingQty.toLocaleString('th-TH'),
        unit: line.unit ?? '',
        poNumber: line.poNumber ?? '',
      },
    }))
}
