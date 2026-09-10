"use client"
import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

/**
 * The marketing screen's React Query keys, defined once. Every key that
 * starts with `orva_marketing.` is owned here (src/lib/__tests__/queryKeyOwnership).
 */

export type Contact = {
  id: string; kind: 'person' | 'company'; displayName: string; email: string | null
  consent: boolean; consentAt: string | null; consentSource: string | null
}
export type AudienceCounts = { total: number; consented: number; reachable: number; noEmail: number; notConsented: number }
export type AudienceResponse = { counts: AudienceCounts; contacts: Contact[] }

export type Broadcast = {
  id: string; subject: string; body: string; status: string
  audienceCount: number; sentCount: number; failedCount: number
  sentAt: string | null; createdAt: string; updatedAt: string
}
export type Recipient = {
  id: string; customerEntityId: string; displayName: string; email: string
  status: string; messageId: string | null; error: string | null; updatedAt: string
}

export const AUDIENCE_KEY = 'orva_marketing.audience'
export const BROADCASTS_KEY = 'orva_marketing.broadcasts'
export const RECIPIENTS_KEY = 'orva_marketing.recipients'

export function useAudience(search: string) {
  const scopeVersion = useOrganizationScopeVersion()
  return useQuery({
    queryKey: ['orva_marketing.audience', search, scopeVersion],
    queryFn: () => {
      const qs = new URLSearchParams()
      if (search) qs.set('search', search)
      return readApiResultOrThrow<AudienceResponse>(`/api/orva_marketing/audience${qs.size ? `?${qs}` : ''}`)
    },
  })
}

export function useBroadcasts() {
  const scopeVersion = useOrganizationScopeVersion()
  return useQuery({
    queryKey: ['orva_marketing.broadcasts', scopeVersion],
    queryFn: () => readApiResultOrThrow<{ items: Broadcast[] }>('/api/orva_marketing/broadcasts?pageSize=100'),
  })
}

export function useRecipients(broadcastId: string | null) {
  const scopeVersion = useOrganizationScopeVersion()
  return useQuery({
    queryKey: ['orva_marketing.recipients', broadcastId, scopeVersion],
    enabled: Boolean(broadcastId),
    queryFn: () => readApiResultOrThrow<{ items: Recipient[] }>(`/api/orva_marketing/broadcasts/recipients?broadcastId=${broadcastId}`),
  })
}
