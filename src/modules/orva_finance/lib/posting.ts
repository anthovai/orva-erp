import type { EntityManager } from '@mikro-orm/postgresql'

export type LineAmounts = { debit: number | string; credit: number | string }

/** Normalize a client-supplied amount to the DB's numeric(18,4) string form. */
export function toAmount(value: number | string): string {
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n) || n < 0) throw new Error('orva_gl: invalid amount')
  return n.toFixed(4)
}

/** Sum lines into header totals (numeric(18,4) strings). */
export function computeTotals(lines: LineAmounts[]): { totalDebit: string; totalCredit: string; balanced: boolean } {
  let debit = 0
  let credit = 0
  for (const line of lines) {
    debit += Number(line.debit)
    credit += Number(line.credit)
  }
  const totalDebit = debit.toFixed(4)
  const totalCredit = credit.toFixed(4)
  return { totalDebit, totalCredit, balanced: totalDebit === totalCredit && debit > 0 }
}

export type PostabilityInput = {
  journalStatus: string
  journalDate: string
  lines: LineAmounts[]
  period: { status: string; startsOn: string; endsOn: string } | null
}

/** Pure posting-rule check; the DB trigger enforces the same rules as backstop. */
export function checkPostable(input: PostabilityInput): { ok: true } | { ok: false; reason: string } {
  if (input.journalStatus !== 'draft') return { ok: false, reason: 'only draft journals can be posted' }
  if (input.lines.length < 2) return { ok: false, reason: 'a journal needs at least two lines' }
  const totals = computeTotals(input.lines)
  if (!totals.balanced) {
    return { ok: false, reason: `journal is not balanced (debit ${totals.totalDebit}, credit ${totals.totalCredit})` }
  }
  if (!input.period) return { ok: false, reason: 'period not found' }
  if (input.period.status !== 'open') return { ok: false, reason: 'period is closed' }
  if (input.journalDate < input.period.startsOn || input.journalDate > input.period.endsOn) {
    return { ok: false, reason: 'journal date is outside the period' }
  }
  return { ok: true }
}

/**
 * Race-safe journal number allocation via the orva_gl_sequences upsert.
 * Must run inside the caller's transaction (withTenantRls).
 */
export async function allocateJournalNo(
  tem: EntityManager,
  tenantId: string,
  organizationId: string,
): Promise<string> {
  const rows = (await tem.execute(
    `insert into orva_gl_sequences as s (tenant_id, organization_id, kind, next_value)
     values (?, ?, 'journal', 2)
     on conflict (tenant_id, organization_id, kind)
     do update set next_value = s.next_value + 1
     returning next_value - 1 as seq`,
    [tenantId, organizationId],
  )) as Array<{ seq: string | number }>
  const seq = Number(rows[0]?.seq ?? 0)
  if (!seq) throw new Error('orva_gl: journal number allocation failed')
  return `JE-${String(seq).padStart(6, '0')}`
}
