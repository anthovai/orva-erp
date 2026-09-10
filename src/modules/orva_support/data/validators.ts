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
  /** Also send this reply to the ticket's contact email (staff replies only). */
  sendEmail: z.boolean().optional().default(false),
})

export const ticketQuerySchema = z.object({ id: z.string().uuid() })

/** Fold one ticket into another; `updatedAt` is the target's optimistic lock. */
export const ticketMergeSchema = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  updatedAt: z.string().min(1),
})

export const SUBSCRIPTION_KINDS = ['software', 'domain', 'hosting', 'certificate', 'other'] as const
export const BILLING_CYCLES = ['monthly', 'quarterly', 'yearly', 'one_time'] as const
export const SUBSCRIPTION_STATUSES = ['active', 'cancelled'] as const

export const subscriptionListSchema = z
  .object({
    status: z.enum(SUBSCRIPTION_STATUSES).optional(),
    kind: z.enum(SUBSCRIPTION_KINDS).optional(),
    /** 'due' keeps only lapsed + within the lead window */
    bucket: z.enum(['all', 'due']).optional().default('all'),
    search: z.string().trim().max(200).optional(),
    today: isoDate.optional(),
  })
  .passthrough()

/** Retainer: the customer pays us this each cycle; the owner issues the invoice. */
const retainerFields = {
  invoiceOnRenewal: z.coerce.boolean().optional(),
  // null first: z.coerce.number() would turn null into 0 and bill ฿0.
  retainerAmount: z.union([z.null(), z.literal('').transform(() => null), z.coerce.number().min(0).max(1e12)]).optional(),
}

export const subscriptionCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  vendor: z.string().trim().max(200).optional().nullable(),
  kind: z.enum(SUBSCRIPTION_KINDS).default('software'),
  cost: z.coerce.number().min(0).max(1e12).optional().default(0),
  currencyCode: z.string().trim().length(3).optional().default('THB'),
  billingCycle: z.enum(BILLING_CYCLES).default('yearly'),
  renewsOn: isoDate.optional().nullable(),
  autoRenew: z.coerce.boolean().optional().default(true),
  expenseAccountCode: z.string().trim().max(40).optional().nullable(),
  customerEntityId: z.string().uuid().optional().nullable(),
  quoteId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  ...retainerFields,
})

export const subscriptionUpdateSchema = subscriptionCreateSchema
  .partial()
  .extend({
    id: z.string().uuid(),
    status: z.enum(SUBSCRIPTION_STATUSES).optional(),
    /** Roll the renewal date one cycle on and stamp it paid. */
    markRenewed: z.boolean().optional(),
    today: isoDate.optional(),
    /** Optimistic lock — the row's updatedAt as read. */
    updatedAt: z.string().min(1),
  })

// ── Knowledge base (H4a) ─────────────────────────────────────────────────────

/** Lower-case, ASCII/Thai word characters and dashes; what the portal URL carries. */
export const slugSchema = z.string().trim().min(1).max(120).regex(/^[\p{L}\p{N}\p{M}]+(?:-[\p{L}\p{N}\p{M}]+)*$/u, 'ใช้ตัวอักษร ตัวเลข และขีดกลางเท่านั้น')

export const articleListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  published: z.enum(['all', 'yes', 'no']).optional().default('all'),
})

export const articleCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: slugSchema.optional(),
  summary: z.string().trim().max(500).optional().nullable(),
  body: z.string().trim().min(1).max(50_000),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  isPublished: z.coerce.boolean().optional().default(false),
  position: z.coerce.number().int().min(0).max(9999).optional().default(0),
})

export const articleUpdateSchema = articleCreateSchema.partial().extend({
  id: z.string().uuid(),
  /** Optimistic lock — the row's updatedAt as read. */
  updatedAt: z.string().min(1),
})

export const articleDeleteSchema = z.object({ id: z.string().uuid() })

/** Public portal read: a slug picks one article, otherwise the published list. */
export const portalArticleQuerySchema = z.object({
  slug: slugSchema.optional(),
  search: z.string().trim().max(200).optional(),
})

/** Issue this retainer's invoice for the current cycle. */
export const retainerIssueSchema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string().min(1),
  /** Overrides the stored retainer amount for this cycle only. */
  amount: z.coerce.number().positive().max(1e12).optional(),
  dueInDays: z.coerce.number().int().min(0).max(365).optional(),
})
