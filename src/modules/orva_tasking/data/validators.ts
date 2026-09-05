import { z } from 'zod'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional().nullable(),
  /** The quotation this work bills against; absent for internal work. */
  quoteId: z.string().uuid().optional().nullable(),
})

export const projectUpdateSchema = projectCreateSchema.partial().extend({
  id: z.string().uuid(),
  isArchived: z.boolean().optional(),
  updatedAt: z.string().min(1),
})

export const taskListSchema = z.object({
  projectId: z.string().uuid().optional(),
  /** 'open' hides finished work, which is the normal way to read the list. */
  bucket: z.enum(['open', 'all']).optional().default('open'),
  /**
   * Only tasks with both a start and an end — what a timeline can draw.
   * Parsed by hand because `z.coerce.boolean()` reads the string "0" as true,
   * which would make `hasDates=0` filter instead of not filtering.
   */
  hasDates: z.enum(['0', '1', 'true', 'false']).optional().transform((v) => v === '1' || v === 'true'),
})

/** A duration runs forwards; the database enforces it too. */
const datesInOrder = <T extends { startDate?: string | null; endDate?: string | null }>(v: T) =>
  !v.startDate || !v.endDate || v.startDate <= v.endDate

const datesMessage = { message: 'วันเริ่มต้องไม่หลังวันจบ', path: ['endDate'] }

export const taskCreateSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(250),
  description: z.string().trim().max(8000).optional().nullable(),
  dueOn: isoDate.optional().nullable(),
  startDate: isoDate.optional().nullable(),
  endDate: isoDate.optional().nullable(),
  percentDone: z.coerce.number().int().min(0).max(100).optional().default(0),
  priority: z.coerce.number().int().min(0).max(4).optional().default(0),
  assigneeUserId: z.string().uuid().optional().nullable(),
  /** Labels applied as the task is created, so one round trip is enough. */
  labelIds: z.array(z.string().uuid()).max(20).optional(),
}).refine(datesInOrder, datesMessage)

export const taskUpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(250).optional(),
  description: z.string().trim().max(8000).optional().nullable(),
  done: z.boolean().optional(),
  dueOn: isoDate.optional().nullable(),
  startDate: isoDate.optional().nullable(),
  endDate: isoDate.optional().nullable(),
  percentDone: z.coerce.number().int().min(0).max(100).optional(),
  priority: z.coerce.number().int().min(0).max(4).optional(),
  assigneeUserId: z.string().uuid().optional().nullable(),
  /** When present, replaces the whole set — absent leaves labels untouched. */
  labelIds: z.array(z.string().uuid()).max(20).optional(),
  /** Optimistic lock — the row's updatedAt as read. */
  updatedAt: z.string().min(1),
})

export const labelCreateSchema = z.object({
  title: z.string().trim().min(1).max(60),
  hexColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#64748b'),
})

export const labelUpdateSchema = labelCreateSchema.partial().extend({
  id: z.string().uuid(),
  updatedAt: z.string().min(1),
})

export const labelDeleteSchema = z.object({ id: z.string().uuid() })

export const commentListSchema = z.object({ taskId: z.string().uuid() })

export const commentCreateSchema = z.object({
  taskId: z.string().uuid(),
  body: z.string().trim().min(1).max(8000),
  /** Off by default — an internal note is the common case. */
  isCustomerVisible: z.boolean().optional().default(false),
})

export const commentUpdateSchema = z.object({
  id: z.string().uuid(),
  body: z.string().trim().min(1).max(8000).optional(),
  isCustomerVisible: z.boolean().optional(),
  updatedAt: z.string().min(1),
})

export const commentDeleteSchema = z.object({ id: z.string().uuid() })

/** The three a person picks; the inverse is written for them. */
export const RELATION_KINDS = ['subtask', 'blocks', 'related'] as const

export const relationCreateSchema = z.object({
  taskId: z.string().uuid(),
  otherTaskId: z.string().uuid(),
  kind: z.enum(RELATION_KINDS),
}).refine((v) => v.taskId !== v.otherTaskId, {
  message: 'งานเชื่อมกับตัวเองไม่ได้',
  path: ['otherTaskId'],
})

export const relationDeleteSchema = z.object({
  taskId: z.string().uuid(),
  otherTaskId: z.string().uuid(),
})

export const attachmentFlagSchema = z.object({
  taskId: z.string().uuid(),
  attachmentId: z.string().uuid(),
  isCustomerVisible: z.boolean(),
})
