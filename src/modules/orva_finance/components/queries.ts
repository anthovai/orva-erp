"use client"
import { useQuery } from '@tanstack/react-query'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

/**
 * The finance option sources every screen shares, each defined exactly once.
 *
 * A React Query key is a contract about shape. Seven screens used to declare
 * `['orva_finance.accounts.all', scopeVersion]` for themselves — six cached the
 * `{ items }` envelope, one cached the bare array — so whichever screen rendered
 * first decided what the next one read, and ค่าใช้จ่ายจ่ายสด died with
 * "allAccounts.filter is not a function" after a visit to ใบวางบิลผู้ขาย. Only
 * on client-side navigation, because only then does the cache survive; a
 * reload never reproduced it. `src/lib/__tests__/queryKeyOwnership.test.ts`
 * now fails the build when a key's first segment is defined in two files, and
 * this file is where the finance ones live.
 *
 * Every hook returns the unwrapped array plus `isLoading` and `failed` — the
 * purchasing pickers' shape — because a failed lookup rendered as "you have
 * no accounts" sends the operator to fix data that is fine.
 *
 * `PAGE_SIZE` is the ceiling the list contracts allow; the chart of accounts
 * is filtered by type on the client rather than fetched once per type, so one
 * key serves every picker.
 */
export const PAGE_SIZE = 100

export type AccountOption = { id: string; code: string; name: string; account_type: string; parent_id?: string | null }
export type PeriodOption = { id: string; code: string; status: string; starts_on?: string | null; ends_on?: string | null }
export type GlSettings = {
  retainedEarningsAccountId: string | null
  accountantEmail?: string | null
  accountantName?: string | null
}

const ACCOUNT_LIST = { page: 1, pageSize: PAGE_SIZE, sortField: 'code', sortDir: 'asc' as const }
const PERIOD_LIST = { page: 1, pageSize: PAGE_SIZE, sortField: 'starts_on', sortDir: 'desc' as const }

/** The active chart of accounts, ordered by code. Filter with `byType`. */
export function useActiveAccounts() {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['orva_finance.accounts.all', scopeVersion],
    queryFn: async () =>
      (await fetchCrudList<AccountOption>('orva_finance/gl/accounts', { ...ACCOUNT_LIST, isActive: true })).items ?? [],
  })
  return { accounts: query.data ?? [], isLoading: query.isLoading, failed: query.isError, refetch: query.refetch }
}

/** The accounts of one type, in chart order. */
export function byType<T extends { account_type?: string }>(accounts: T[], type: string): T[] {
  return accounts.filter((account) => account.account_type === type)
}

/**
 * Accounts a line can actually post to: the ones nothing hangs under. A header
 * such as 1000 "เงินสดและเงินฝากธนาคาร" groups the cash accounts and is not one
 * of them — offering it in a picker is how a payment lands on a subtotal.
 */
export function leafAccounts<T extends { id: string; parent_id?: string | null }>(accounts: T[]): T[] {
  const parents = new Set(accounts.map((account) => account.parent_id).filter(Boolean))
  return accounts.filter((account) => !parents.has(account.id))
}

/** Fiscal periods still open for posting, newest first. */
export function useOpenPeriods() {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['orva_finance.periods.open', scopeVersion],
    queryFn: async () =>
      (await fetchCrudList<PeriodOption>('orva_finance/gl/periods', { ...PERIOD_LIST, status: 'open' })).items ?? [],
  })
  return { periods: query.data ?? [], isLoading: query.isLoading, failed: query.isError }
}

/** Every fiscal period, open or closed, newest first — for reports. */
export function useAllPeriods() {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['orva_finance.periods.all', scopeVersion],
    queryFn: async () => (await fetchCrudList<PeriodOption>('orva_finance/gl/periods', PERIOD_LIST)).items ?? [],
  })
  return { periods: query.data ?? [], isLoading: query.isLoading, failed: query.isError }
}

export type ApSettings = { apAccountId: string | null; inputVatAccountId?: string | null; whtPayableAccountId?: string | null }

/** The AP posting accounts — what decides whether a receipt's VAT or a withholding can be booked at all. */
export function useApSettings() {
  const scopeVersion = useOrganizationScopeVersion()
  return useQuery({
    queryKey: ['orva_finance.ap.settings', scopeVersion],
    queryFn: async () => readApiResultOrThrow<ApSettings>('/api/orva_finance/ap/settings'),
  })
}

/** The GL settings row; the route answers all-null fields on an empty tenant, never 404. */
export function useGlSettings() {
  const scopeVersion = useOrganizationScopeVersion()
  return useQuery({
    queryKey: ['orva_finance.gl.settings', scopeVersion],
    queryFn: async () => readApiResultOrThrow<GlSettings>('/api/orva_finance/gl/settings'),
  })
}
