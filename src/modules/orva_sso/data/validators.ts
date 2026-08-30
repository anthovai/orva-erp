import { z } from 'zod'

const pagedList = {
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
  withDeleted: z.coerce.boolean().optional().default(false),
  organizationId: z.string().uuid().optional(),
}

export const connectionListSchema = z
  .object({
    ...pagedList,
    sortField: z.string().optional().default('name'),
    search: z.string().optional(),
    enabled: z.coerce.boolean().optional(),
  })
  .passthrough()

/** "Acme.co.th, ACME.com" → "acme.co.th,acme.com" (lowercase, deduped). */
export function normalizeEmailDomains(input: string): string {
  const domains = input
    .split(',')
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter((domain) => domain.length > 0)
  return Array.from(new Set(domains)).join(',')
}

const emailDomainsSchema = z
  .string()
  .min(3)
  .transform(normalizeEmailDomains)
  .refine((value) => value.length > 0 && value.split(',').every((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)), {
    message: 'Email domains must be a comma-separated list of valid domains',
  })

export const connectionCreateSchema = z.object({
  name: z.string().min(1),
  issuerUrl: z.string().url().refine((value) => value.startsWith('https://') || value.startsWith('http://localhost') || value.startsWith('http://127.0.0.1'), {
    message: 'Issuer must use https (localhost allowed for development)',
  }),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  emailDomains: emailDomainsSchema,
  enabled: z.boolean().optional().default(true),
})

export const connectionUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  issuerUrl: connectionCreateSchema.shape.issuerUrl.optional(),
  clientId: z.string().min(1).optional(),
  /** Blank = keep the stored secret. */
  clientSecret: z.string().optional(),
  emailDomains: emailDomainsSchema.optional(),
  enabled: z.boolean().optional(),
})

export const discoverQuerySchema = z.object({ email: z.string().email() })
export const startQuerySchema = z.object({
  email: z.string().email(),
  redirect: z.string().optional(),
})
export const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
})

export const deleteByIdSchema = z.object({ id: z.string().uuid() })
