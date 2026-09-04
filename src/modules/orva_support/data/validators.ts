import { z } from 'zod'

export const TICKET_KINDS = ['bug', 'question', 'change_request', 'incident'] as const
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export const TICKET_STATUSES = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'] as const
/** Statuses that still need work from us or the customer. */
export const OPEN_STATUSES = ['open', 'in_progress', 'waiting_customer'] as const

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const ticketListSchema = z
  .object({
    page: z.coerce.number().int().min(1).optional().default(1),
    pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
    status: z.enum(TICKET_STATUSES).optional(),
    /** 'open' groups open + in_progress + waiting_customer */
    bucket: z.enum(['open', 'all']).optional().default('open'),
    kind: z.enum(TICKET_KINDS).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    customerEntityId: z.string().uuid().optional(),
    quoteId: z.string().uuid().optional(),
    search: z.string().trim().max(200).optional(),
  })
  .passthrough()

export const ticketCreateSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  description: z.string().trim().max(8000).optional().nullable(),
  kind: z.enum(TICKET_KINDS).default('bug'),
  priority: z.enum(TICKET_PRIORITIES).default('normal'),
  customerEntityId: z.string().uuid().optional().nullable(),
  contactEmail: z.string().trim().email().max(200).optional().nullable(),
  quoteId: z.string().uuid().optional().nullable(),
  dueOn: isoDate.optional().nullable(),
})

export const ticketUpdateSchema = z.object({
  id: z.string().uuid(),
  subject: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(8000).optional().nullable(),
  kind: z.enum(TICKET_KINDS).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  status: z.enum(TICKET_STATUSES).optional(),
  customerEntityId: z.string().uuid().optional().nullable(),
  contactEmail: z.string().trim().email().max(200).optional().nullable(),
  quoteId: z.string().uuid().optional().nullable(),
  dueOn: isoDate.optional().nullable(),
  /** Optimistic lock — the ticket's updatedAt as read. */
  updatedAt: z.string().min(1),
})

export const replyCreateSchema = z.object({
  ticketId: z.string().uuid(),
  author: z.enum(['staff', 'customer', 'note']).default('staff'),
  body: z.string().trim().min(1).max(8000),
  minutesSpent: z.coerce.number().int().min(0).max(10_000).optional().default(0),
  /** Move the ticket at the same time (optional). */
  status: z.enum(TICKET_STATUSES).optional(),
})

export const ticketQuerySchema = z.object({ id: z.string().uuid() })
