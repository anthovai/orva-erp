import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { CustomerDeal } from '@open-mercato/core/modules/customers/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { checkRateLimit, getClientIp, RATE_LIMIT_FALLBACK_KEY } from '@open-mercato/shared/lib/ratelimit/helpers'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import {
  DEDUPE_WINDOW_MS, isDuplicateWithin, leadDescription, leadTitle, looksLikeBot,
  normaliseEmail, normaliseSource,
} from '../../lib/lead'

/** Public: anyone with the link may submit. Never expose a read here. */
export const metadata = {
  POST: { requireAuth: false },
}

const logger = createLogger('orva').child({ component: 'lead' })

const leadSchema = z.object({
  orgSlug: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200),
  company: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  source: z.string().trim().max(150).optional().nullable(),
  message: z.string().trim().max(4000).optional().nullable(),
  /** Hidden field; humans leave it empty. */
  website: z.string().max(200).optional().nullable(),
})

const rateLimitConfig = readEndpointRateLimitConfig('ORVA_LEAD', {
  points: 5,
  duration: 60,
  blockDuration: 600,
  keyPrefix: 'orva_lead',
})

/** Deliberately identical for accepted, deduplicated and bot submissions. */
const accepted = () => Response.json({ ok: true })

/**
 * Turns a public enquiry into a deal on the pipeline with its channel filled in.
 *
 * Scope is resolved from the organization slug **server side**; the payload
 * never carries a tenant or organization id, because a public caller must not
 * be able to name the tenant it writes into. The deal is created through
 * `customers.deals.create`, so the pipeline's default stage, custom-field
 * write and CRUD side effects behave exactly as they do from the backend form.
 */
export async function POST(req: Request) {
  const parsed = leadSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const input = parsed.data

  // A bot gets the same answer a human does; telling it otherwise only teaches
  // it to retry without the trap.
  if (looksLikeBot(input.website)) return accepted()

  const rateLimiter = getCachedRateLimiterService()
  if (rateLimiter) {
    const ip = getClientIp(req, rateLimiter.trustProxyDepth)
    const limited = await checkRateLimit(rateLimiter, rateLimitConfig, ip ?? RATE_LIMIT_FALLBACK_KEY, 'Too many requests.')
    if (limited) return limited
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  const org = await em.findOne(Organization, { slug: input.orgSlug, deletedAt: null }, { populate: ['tenant'] })
  if (!org) return Response.json({ error: 'Unknown organization' }, { status: 404 })
  const rawTenant = (org as unknown as { tenant?: unknown }).tenant
  const tenantId = typeof rawTenant === 'string'
    ? rawTenant
    : (rawTenant as { id?: unknown } | null)?.id
      ? String((rawTenant as { id: unknown }).id)
      : null
  if (!tenantId) return Response.json({ error: 'Unknown organization' }, { status: 404 })
  const organizationId = String(org.id)

  const email = normaliseEmail(input.email)
  const source = normaliseSource(input.source)
  const now = new Date()

  try {
    const outcome = await withTenantRls(em, tenantId, async (tem) => {
      // Same address inside the window is one lead: a double-tapped submit or
      // an impatient follow-up should not open a second card on the pipeline.
      //
      // The address lives in `description`, which is ENCRYPTED at rest — a
      // `description ilike '%email%'` would compare against ciphertext, never
      // match, and silently duplicate every resubmission. So bound the search
      // by created_at (not encrypted) and match on the decrypted text.
      const cutoff = new Date(now.getTime() - DEDUPE_WINDOW_MS)
      const recentDeals = await findWithDecryption(
        tem, CustomerDeal,
        { tenantId, organizationId, deletedAt: null, createdAt: { $gte: cutoff } },
        { orderBy: { createdAt: 'desc' }, limit: 50 },
        { tenantId },
      )
      const duplicate = recentDeals.find((deal) =>
        typeof deal.description === 'string'
        && deal.description.includes(email)
        && isDuplicateWithin(deal.createdAt, now),
      )
      if (duplicate) return { deduplicated: true as const, dealId: String(duplicate.id) }

      // Without an explicit stage the deal is created off-board — it exists but
      // never appears on the pipeline, which is the only place the owner would
      // look. Resolve the default pipeline's first stage rather than hard-coding
      // one, and fall back to any pipeline if none is marked default.
      const [stage] = (await tem.execute(
        `select s.id::text as stage_id, s.pipeline_id::text as pipeline_id
         from customer_pipeline_stages s
         join customer_pipelines p on p.id = s.pipeline_id
         where p.tenant_id = ?::uuid and p.organization_id = ?::uuid
         order by p.is_default desc, s.position
         limit 1`,
        [tenantId, organizationId],
      )) as Array<{ stage_id: string; pipeline_id: string }>
      if (!stage) throw new Error('No pipeline stage is configured for this organization')

      const commandBus = container.resolve('commandBus') as CommandBus
      const ctx: CommandRuntimeContext = {
        container,
        auth: null,
        organizationScope: null,
        selectedOrganizationId: organizationId,
        organizationIds: [organizationId],
        request: req,
        transactionalEm: tem,
      }
      const result = (await commandBus.execute('customers.deals.create', {
        input: {
          tenantId,
          organizationId,
          title: leadTitle({ name: input.name, company: input.company }),
          pipelineId: stage.pipeline_id,
          pipelineStageId: stage.stage_id,
          description: leadDescription({
            name: input.name, email, company: input.company, phone: input.phone,
            message: input.message, source,
          }),
          // Upstream's own free-text field, kept in step with the constrained
          // custom field the pipeline filters on.
          source,
          cf_lead_source: source,
        },
        ctx,
      })) as { result?: { dealId?: string; id?: string } | null; dealId?: string } | null
      const dealId = result?.result?.dealId ?? result?.dealId ?? result?.result?.id ?? null
      return { deduplicated: false as const, dealId }
    })

    logger.info('Lead captured', {
      organizationId, source,
      deduplicated: outcome.deduplicated,
      dealId: outcome.dealId,
    })
    return accepted()
  } catch (error) {
    logger.error('Lead capture failed', {
      organizationId,
      err: error instanceof Error ? error.message : String(error),
    })
    return Response.json({ error: 'Could not submit the enquiry' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva',
  summary: 'Public lead capture',
  methods: {
    POST: {
      summary: 'Create a deal from a public enquiry form',
      description:
        'Unauthenticated. Scope comes from the organization slug, never from the payload. Rate limited per IP, honeypot protected, and deduplicated per email within 24 hours. Always answers 200 for accepted, deduplicated and bot submissions alike so the response reveals nothing.',
      tags: ['Orva'],
      requestBody: { schema: leadSchema },
      responses: [{ status: 200, description: 'Submission accepted.', schema: z.object({ ok: z.boolean() }) }],
      errors: [
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Unknown organization', schema: z.object({ error: z.string() }) },
        { status: 429, description: 'Rate limited', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
