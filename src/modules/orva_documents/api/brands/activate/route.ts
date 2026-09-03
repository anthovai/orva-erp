import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { brandActivateSchema } from '../../../data/validators'
import { BRAND_COOKIE, loadBrands } from '../../../lib/brands'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_documents.view'] },
}

const ACTIVE_HOURS = 8

/**
 * Switches the operator's active brand: the upstream create screen has no
 * brand field, so the choice travels in a short-lived cookie that the
 * document-numbers route reads when it previews the next number. Null puts
 * the operator back on the default (settings) brand.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = brandActivateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const code = parsed.data.code
  const tenantId = auth.tenantId
  if (code) {
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const known = await withTenantRls(em, tenantId, async (tem) => (await loadBrands(tem, { tenantId, organizationId })).some((b) => b.code === code))
    if (!known) return Response.json({ error: 'Brand not found' }, { status: 404 })
  }
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : ''
  const cookie = code
    ? `${BRAND_COOKIE}=${encodeURIComponent(code)}; Path=/; Max-Age=${ACTIVE_HOURS * 3600}; HttpOnly; SameSite=Lax${secure}`
    : `${BRAND_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`
  return new Response(JSON.stringify({ ok: true, activeCode: code }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'set-cookie': cookie },
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Documents',
  summary: 'Switch the active brand for new documents',
  methods: {
    POST: {
      summary: 'Set (or clear with null) the brand whose number series the create screen previews next',
      tags: ['Orva Documents'],
      requestBody: { schema: brandActivateSchema },
      responses: [{ status: 200, description: 'Active brand.', schema: z.object({ ok: z.boolean(), activeCode: z.string().nullable() }) }],
    },
  },
}
