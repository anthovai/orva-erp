import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { checkRateLimit, getClientIp, RATE_LIMIT_FALLBACK_KEY } from '@open-mercato/shared/lib/ratelimit/helpers'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { UnsubscribeToken } from '../../data/entities'
import { unsubscribeSchema } from '../../data/validators'
import { CONSENT_KEY, CUSTOMER_ENTITY_ID } from '../../lib/audience'
import { setConsent } from '../../lib/consent'

/** Public: the link in the email is the whole credential. Nothing here lists anything. */
export const metadata = {
  GET: { requireAuth: false },
  POST: { requireAuth: false },
}

const rateLimitConfig = readEndpointRateLimitConfig('ORVA_UNSUBSCRIBE', {
  points: 10,
  duration: 60,
  blockDuration: 600,
  keyPrefix: 'orva_unsubscribe',
})

const statusSchema = z.object({ ok: z.boolean(), displayName: z.string(), consent: z.boolean() })

/**
 * The token names the tenant, the organisation and the contact server side;
 * the page sends nothing else. An unknown token is a 404 with no hint of
 * whether it ever existed.
 */
async function resolve(req: Request, token: string) {
  const rateLimiter = getCachedRateLimiterService()
  if (rateLimiter) {
    const ip = getClientIp(req, rateLimiter.trustProxyDepth)
    const limited = await checkRateLimit(rateLimiter, rateLimitConfig, ip ?? RATE_LIMIT_FALLBACK_KEY, 'Too many requests.')
    if (limited) return { limited }
  }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const row = await em.fork().findOne(UnsubscribeToken, { token })
  if (!row) return { notFound: true as const }
  const scope = { tenantId: row.tenantId, organizationId: row.organizationId }
  const state = await withTenantRls(em, scope.tenantId, async (tem) => {
    const [entity] = await findWithDecryption(
      tem, CustomerEntity,
      { id: row.customerEntityId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
      { limit: 1 },
      { tenantId: scope.tenantId },
    )
    if (!entity) return null
    const consentRows = (await tem.execute(
      `select value_bool from custom_field_values
       where entity_id = ? and record_id = ? and field_key = ? and organization_id = ?::uuid and deleted_at is null
       limit 1`,
      [CUSTOMER_ENTITY_ID, row.customerEntityId, CONSENT_KEY, scope.organizationId],
    )) as Array<{ value_bool: boolean | null }>
    return { displayName: String(entity.displayName ?? ''), consent: consentRows[0]?.value_bool === true }
  })
  if (!state) return { notFound: true as const }
  return { container, em, row, scope, state }
}

/** What the page shows before the button: who this is for and whether they still receive news. */
export async function GET(req: Request) {
  const parsed = unsubscribeSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid token' }, { status: 400 })
  const resolved = await resolve(req, parsed.data.token)
  if ('limited' in resolved) return resolved.limited
  if ('notFound' in resolved) return Response.json({ error: 'Unknown link' }, { status: 404 })
  return Response.json({ ok: true, displayName: resolved.state.displayName, consent: resolved.state.consent })
}

/** Withdraws consent: the CRM record says no, dated today, source "unsubscribe". */
export async function POST(req: Request) {
  const parsed = unsubscribeSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid token' }, { status: 400 })
  const resolved = await resolve(req, parsed.data.token)
  if ('limited' in resolved) return resolved.limited
  if ('notFound' in resolved) return Response.json({ error: 'Unknown link' }, { status: 404 })
  const { container, em, row, scope, state } = resolved
  const dataEngine = container.resolve<DataEngine>('dataEngine')
  await setConsent(dataEngine, scope, row.customerEntityId, false, 'unsubscribe')
  await withTenantRls(em, scope.tenantId, (tem) => tem.execute(
    'update orva_marketing_unsubscribe_tokens set used_at = now() where id = ?::uuid and tenant_id = ?::uuid',
    [row.id, scope.tenantId],
  ))
  return Response.json({ ok: true, displayName: state.displayName, consent: false })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Marketing',
  summary: 'Unsubscribe (public)',
  methods: {
    GET: { summary: 'Who the link belongs to and whether they still receive news', tags: ['Orva Marketing'], query: unsubscribeSchema, responses: [{ status: 200, description: 'State.', schema: statusSchema }] },
    POST: { summary: 'Withdraw marketing consent through the emailed link', tags: ['Orva Marketing'], requestBody: { schema: unsubscribeSchema }, responses: [{ status: 200, description: 'Withdrawn.', schema: statusSchema }] },
  },
}
