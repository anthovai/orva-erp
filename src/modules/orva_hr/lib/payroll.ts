import type { EntityManager } from '@mikro-orm/postgresql'
import type { JournalLineDraft } from '@/modules/orva_finance/lib/ap'

export type EngineLine = {
  id: string
  gross: number
  ssoEmployee: number
  ssoEmployer: number
  wht: number
  net: number
}

export type EngineResult = {
  lines: EngineLine[]
  totals: { gross: number; ssoEmployee: number; ssoEmployer: number; wht: number; net: number }
}

export function payrollEngineUrl(): string {
  return process.env.PAYROLL_ENGINE_URL || 'http://127.0.0.1:8701'
}

/**
 * Calls the Rust payroll engine. Fails loudly when the sidecar is down —
 * payroll math must come from the tested engine, never a silent JS fallback.
 */
export async function callPayrollEngine(
  employees: Array<{ id: string; salary: number; whtRate: number }>,
): Promise<{ result: EngineResult; engineVersion: string }> {
  const base = payrollEngineUrl()
  let health: { version?: string } = {}
  try {
    const healthRes = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) })
    health = (await healthRes.json()) as { version?: string }
  } catch {
    throw Object.assign(
      new Error(`Payroll engine is not reachable at ${base} — start services/payroll-engine (cargo run --release)`),
      { status: 503 },
    )
  }
  const res = await fetch(`${base}/calculate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ employees }),
    signal: AbortSignal.timeout(15000),
  })
  const body = (await res.json()) as EngineResult & { error?: string }
  if (!res.ok) {
    throw Object.assign(new Error(body.error ?? 'Payroll engine rejected the input'), { status: 400 })
  }
  return { result: body, engineVersion: health.version ?? 'unknown' }
}

export type HrAccounts = {
  salaryExpenseAccountId: string
  ssoExpenseAccountId: string
  ssoPayableAccountId: string
  taxPayableAccountId: string
  netPayableAccountId: string
}

/**
 * Pure journal math for a payroll run:
 *   debit  salary expense           total gross
 *   debit  SSO employer expense     employer contribution
 *   credit SSO payable              employee + employer contributions
 *   credit tax payable              withholding tax
 *   credit net payable              net pay
 * Balanced because gross = ssoEmployee + wht + net (engine identity).
 */
export function buildPayrollJournalLines(
  totals: EngineResult['totals'],
  accounts: HrAccounts,
): JournalLineDraft[] {
  if (totals.gross <= 0) throw new Error('orva_hr: nothing to post')
  const lines: JournalLineDraft[] = [
    { accountId: accounts.salaryExpenseAccountId, debit: totals.gross.toFixed(4), credit: '0.0000', description: 'Salaries' },
  ]
  if (totals.ssoEmployer > 0) {
    lines.push({
      accountId: accounts.ssoExpenseAccountId,
      debit: totals.ssoEmployer.toFixed(4),
      credit: '0.0000',
      description: 'SSO employer contribution',
    })
  }
  const ssoTotal = totals.ssoEmployee + totals.ssoEmployer
  if (ssoTotal > 0) {
    lines.push({
      accountId: accounts.ssoPayableAccountId,
      debit: '0.0000',
      credit: ssoTotal.toFixed(4),
      description: 'SSO payable',
    })
  }
  if (totals.wht > 0) {
    lines.push({
      accountId: accounts.taxPayableAccountId,
      debit: '0.0000',
      credit: totals.wht.toFixed(4),
      description: 'Withholding tax payable',
    })
  }
  lines.push({
    accountId: accounts.netPayableAccountId,
    debit: '0.0000',
    credit: totals.net.toFixed(4),
    description: 'Net salaries payable',
  })
  return lines
}

export async function allocateHrNo(
  tem: EntityManager,
  tenantId: string,
  organizationId: string,
  kind: string,
  prefix: string,
  pad = 4,
): Promise<string> {
  const rows = (await tem.execute(
    `insert into orva_hr_sequences as s (tenant_id, organization_id, kind, next_value)
     values (?, ?, ?, 2)
     on conflict (tenant_id, organization_id, kind)
     do update set next_value = s.next_value + 1
     returning next_value - 1 as seq`,
    [tenantId, organizationId, kind],
  )) as Array<{ seq: string | number }>
  const seq = Number(rows[0]?.seq ?? 0)
  if (!seq) throw new Error(`orva_hr: ${kind} number allocation failed`)
  return `${prefix}-${String(seq).padStart(pad, '0')}`
}
