"use client"
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

/**
 * Parties holding the vendor role — the one source AP bills, AP payments and
 * purchase orders all pick a supplier from. Defined here, in the module that
 * owns parties, so the three screens share one cache entry with one shape
 * (see `src/lib/__tests__/queryKeyOwnership.test.ts` for why that matters).
 *
 * `PAGE_SIZE` is the ceiling the party list contracts allow (`pageSize.max(100)`);
 * asking for more fails validation and renders an empty select. A tenant that
 * passes 100 vendors needs a search-as-you-type picker, not a bigger page.
 */
const PAGE_SIZE = 100

type PartyRoleRow = { id: string; party_id: string }
export type VendorOption = { id: string; display_name: string }

export function useVendors() {
  const scopeVersion = useOrganizationScopeVersion()
  const roles = useQuery({
    queryKey: ['orva_party.vendor-roles', scopeVersion],
    queryFn: async () => fetchCrudList<PartyRoleRow>('orva_party/party-roles', { page: 1, pageSize: PAGE_SIZE, role: 'vendor' }),
  })
  const ids = React.useMemo(
    () => Array.from(new Set((roles.data?.items ?? []).map((row) => row.party_id))),
    [roles.data?.items],
  )
  const parties = useQuery({
    queryKey: ['orva_party.vendors', ids.join(','), scopeVersion],
    queryFn: async () => fetchCrudList<VendorOption>('orva_party/parties', { ids: ids.join(','), pageSize: PAGE_SIZE }),
    enabled: ids.length > 0,
  })
  return {
    vendors: parties.data?.items ?? [],
    isLoading: roles.isLoading || (ids.length > 0 && parties.isLoading),
    // Reported separately from emptiness on purpose: a failed lookup rendered
    // as "you have no vendors" sends the operator to fix data that is fine.
    failed: roles.isError || parties.isError,
  }
}
