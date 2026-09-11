"use client"
import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

/**
 * Support's shared React Query keys. Every key whose first segment starts
 * with `orva_support.` is defined here or in the page that owns it, once —
 * two files defining one segment is the crash `src/lib/__tests__/queryKeyOwnership`
 * exists to prevent.
 */

export type Article = {
  id: string; title: string; slug: string; summary: string | null; body: string
  tags: string[]; isPublished: boolean; position: number; updatedAt: string
}
export type ArticlesResponse = { items: Article[]; counts: { total: number; published: number } }

export type DueRetainer = {
  id: string; name: string; customerName: string | null; quoteId: string | null
  renewsOn: string | null; billingCycle: string; amount: number; updatedAt: string
}

export function useArticles(search: string, published: 'all' | 'yes' | 'no') {
  const scopeVersion = useOrganizationScopeVersion()
  return useQuery({
    queryKey: ['orva_support.articles', search, published, scopeVersion],
    queryFn: () => {
      const qs = new URLSearchParams({ published })
      if (search) qs.set('search', search)
      return readApiResultOrThrow<ArticlesResponse>(`/api/orva_support/articles?${qs}`)
    },
  })
}

export function useDueRetainers() {
  const scopeVersion = useOrganizationScopeVersion()
  return useQuery({
    queryKey: ['orva_support.retainers', scopeVersion],
    queryFn: () => readApiResultOrThrow<{ items: DueRetainer[]; today: string }>('/api/orva_support/retainers'),
  })
}

export type CannedReply = { id: string; title: string; body: string; position: number; updatedAt: string }

/**
 * The answers the desk types every week, kept once.
 *
 * Loaded with the ticket screen rather than on demand: the list is small, and
 * a picker that has to fetch before it can offer anything is a picker nobody
 * uses.
 */
export function useCannedReplies() {
  const scopeVersion = useOrganizationScopeVersion()
  return useQuery({
    queryKey: ['orva_support.cannedReplies', scopeVersion],
    queryFn: () => readApiResultOrThrow<{ items: CannedReply[] }>('/api/orva_support/canned-replies'),
  })
}
