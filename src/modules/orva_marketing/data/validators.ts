import { z } from 'zod'

const uuid = () => z.string().uuid()

export const CONSENT_SOURCES = ['staff', 'form', 'verbal', 'line', 'import', 'unsubscribe'] as const

export const broadcastCreateSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
})

export const broadcastUpdateSchema = z.object({
  id: uuid(),
  /** Optimistic version: the row's current updated_at; a stale one is a 409. */
  updatedAt: z.string().min(1),
  subject: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(20_000).optional(),
})

export const broadcastDeleteSchema = z.object({ id: uuid() })

export const broadcastSendSchema = z.object({
  id: uuid(),
  /** Guards against sending a draft that changed under the button. */
  updatedAt: z.string().min(1),
})

export const broadcastListQuerySchema = z.object({
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

export const recipientsQuerySchema = z.object({
  broadcastId: uuid(),
})

export const audienceQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
})

export const consentSchema = z.object({
  customerEntityId: uuid(),
  consent: z.boolean(),
  source: z.string().trim().max(120).optional(),
})

/** Public: only the token travels; the tenant is resolved from it server side. */
export const unsubscribeSchema = z.object({
  token: z.string().trim().min(16).max(200),
})
