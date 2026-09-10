"use client"
import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

/**
 * The projects (accepted quotations) other modules let the operator pick from:
 * support tickets, subscriptions and tasking all link work to one. One
 * definition, one shape — the array — so the three screens share a cache
 * entry safely (see `src/lib/__tests__/queryKeyOwnership.test.ts`).
 */
export type ProjectOption = { quoteId: string; quoteNumber: string; customerName: string | null }

/** Document brands (number series + logo) — the codes a sale or an import files under. */
export type BrandOption = { code: string; name: string }

export function useBrandCodes() {
  const scopeVersion = useOrganizationScopeVersion()
  return useQuery({
    queryKey: ['orva_documents.brands.codes', scopeVersion],
    queryFn: async () => (await readApiResultOrThrow<{ items: BrandOption[] }>('/api/orva_documents/brands')).items,
  })
}

export function useProjectOptions(enabled = true) {
  const scopeVersion = useOrganizationScopeVersion()
  return useQuery({
    queryKey: ['orva_documents.projects.pick', scopeVersion],
    queryFn: async () => (await readApiResultOrThrow<{ items: ProjectOption[] }>('/api/orva_documents/projects')).items,
    enabled,
  })
}
