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
})

export const taskCreateSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(250),
  description: z.string().trim().max(8000).optional().nullable(),
  dueOn: isoDate.optional().nullable(),
  priority: z.coerce.number().int().min(0).max(4).optional().default(0),
  assigneeUserId: z.string().uuid().optional().nullable(),
})

export const taskUpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(250).optional(),
  description: z.string().trim().max(8000).optional().nullable(),
  done: z.boolean().optional(),
  dueOn: isoDate.optional().nullable(),
  priority: z.coerce.number().int().min(0).max(4).optional(),
  assigneeUserId: z.string().uuid().optional().nullable(),
  /** Optimistic lock — the row's updatedAt as read. */
  updatedAt: z.string().min(1),
})
