import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { ApSettings, GlAccount } from '../../../data/entities'
import { apSettingsPutSchema } from '../../../data/validators'
import { orvaFinanceTag } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_finance.ap.view'] },
  PUT: { requireAuth: true, requireFeatures: ['orva_finance.ap.manage'] },
}

const settingsResponseSchema = z.object({
  apAccountId: z.string().uuid().nullable(),
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const settings = await em.findOne(ApSettings, { tenantId: auth.tenantId, organizationId })
  return Response.json({ apAccountId: settings?.apAccountId ?? null })
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = apSettingsPutSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    await withTenantRls(em, tenantId, async (tem) => {
      const account = await tem.findOne(GlAccount, { id: parsed.data.apAccountId, tenantId, deletedAt: null })
      if (!account) throw Object.assign(new Error('Account not found'), { status: 400 })
      if (account.accountType !== 'liability') {
        throw Object.assign(new Error('AP control account must be a liability account'), { status: 400 })
      }
      const existing = await tem.findOne(ApSettings, { tenantId, organizationId })
      if (existing) {
        existing.apAccountId = parsed.data.apAccountId
      } else {
        const now = new Date()
        tem.persist(tem.create(ApSettings, {
          tenantId,
          organizationId,
          apAccountId: parsed.data.apAccountId,
          createdAt: now,
          updatedAt: now,
        }))
      }
      await tem.flush()
    })
    return Response.json({ apAccountId: parsed.data.apAccountId })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Failed' }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'AP settings',
  methods: {
    GET: {
      summary: 'Read the AP control account for the active organization',
      tags: [orvaFinanceTag],
      responses: [{ status: 200, description: 'Current AP settings.', schema: settingsResponseSchema }],
    },
    PUT: {
      summary: 'Set the AP control account (must be a liability account)',
      tags: [orvaFinanceTag],
      requestBody: { schema: apSettingsPutSchema },
      responses: [{ status: 200, description: 'Updated AP settings.', schema: settingsResponseSchema }],
    },
  },
}
