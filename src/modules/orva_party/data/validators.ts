import { z } from 'zod'

export const partyKinds = ['person', 'company'] as const
export const wellKnownPartyRoles = ['customer', 'vendor', 'employee', 'contact'] as const

export const partyListSchema = z
  .object({
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    sortField: z.string().optional().default('created_at'),
    sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
    search: z.string().optional(),
    kind: z.enum(partyKinds).optional(),
    withDeleted: z.coerce.boolean().optional().default(false),
    organizationId: z.string().uuid().optional(),
  })
  .passthrough()

export const partyCreateSchema = z.object({
  kind: z.enum(partyKinds),
  displayName: z.string().min(1),
  legalName: z.string().optional().nullable(),
  taxId: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('').transform(() => null)),
  phone: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  roles: z.array(z.string().min(1)).optional(),
})

export const partyUpdateSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(partyKinds).optional(),
  displayName: z.string().min(1).optional(),
  legalName: z.string().optional().nullable(),
  taxId: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('').transform(() => null)),
  phone: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

export const partyRoleListSchema = z
  .object({
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    sortField: z.string().optional().default('created_at'),
    sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
    partyId: z.string().uuid().optional(),
    role: z.string().optional(),
    withDeleted: z.coerce.boolean().optional().default(false),
    organizationId: z.string().uuid().optional(),
  })
  .passthrough()

export const partyRoleCreateSchema = z.object({
  partyId: z.string().uuid(),
  role: z.string().min(1),
  configJson: z.record(z.string(), z.unknown()).optional().nullable(),
})

export const partyRoleUpdateSchema = z.object({
  id: z.string().uuid(),
  role: z.string().min(1).optional(),
  configJson: z.record(z.string(), z.unknown()).optional().nullable(),
})

export const partyLinkListSchema = z
  .object({
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    sortField: z.string().optional().default('created_at'),
    sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
    partyId: z.string().uuid().optional(),
    targetEntity: z.string().optional(),
    targetId: z.string().uuid().optional(),
    withDeleted: z.coerce.boolean().optional().default(false),
    organizationId: z.string().uuid().optional(),
  })
  .passthrough()

export const partyLinkCreateSchema = z.object({
  partyId: z.string().uuid(),
  targetEntity: z.string().min(1),
  targetId: z.string().uuid(),
})

export const deleteByIdSchema = z.object({ id: z.string().uuid() })
