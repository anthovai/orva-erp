import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { ArSettings, GlAccount } from '../../../data/entities'
import { arSettingsPutSchema } from '../../../data/validators'
import { orvaFinanceTag } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_finance.ar.view'] },
  PUT: { requireAuth: true, requireFeatures: ['orva_finance.ar.post'] },
}

const settingsResponseSchema = z.object({
  arAccountId: z.string().uuid().nullable(),
  revenueAccountId: z.string().uuid().nullable(),
  taxAccountId: z.string().uuid().nullable(),
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const settings = await em.findOne(ArSettings, { tenantId: auth.tenantId, organizationId })
  return Response.json({
    arAccountId: settings?.arAccountId ?? null,
    revenueAccountId: settings?.revenueAccountId ?? null,
    taxAccountId: settings?.taxAccountId ?? null,
  })
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = arSettingsPutSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    await withTenantRls(em, tenantId, async (tem) => {
      const expectType = async (id: string, type: string, label: string) => {
        const account = await tem.findOne(GlAccount, { id, tenantId, deletedAt: null })
        if (!account) throw Object.assign(new Error(`${label} account not found`), { status: 400 })
        if (account.accountType !== type) {
          throw Object.assign(new Error(`${label} account must be of type ${type}`), { status: 400 })
        }
      }
      await expectType(parsed.data.arAccountId, 'asset', 'AR control')
      await expectType(parsed.data.revenueAccountId, 'income', 'Revenue')
      if (parsed.data.taxAccountId) await expectType(parsed.data.taxAccountId, 'liability', 'Tax payable')

      const existing = await tem.findOne(ArSettings, { tenantId, organizationId })
      if (existing) {
        existing.arAccountId = parsed.data.arAccountId
        existing.revenueAccountId = parsed.data.revenueAccountId
        existing.taxAccountId = parsed.data.taxAccountId ?? null
      } else {
        const now = new Date()
        tem.persist(tem.create(ArSettings, {
          tenantId,
          organizationId,
          arAccountId: parsed.data.arAccountId,
          revenueAccountId: parsed.data.revenueAccountId,
          taxAccountId: parsed.data.taxAccountId ?? null,
          createdAt: now,
          updatedAt: now,
        }))
      }
      await tem.flush()
    })
    return Response.json({
      arAccountId: parsed.data.arAccountId,
      revenueAccountId: parsed.data.revenueAccountId,
      taxAccountId: parsed.data.taxAccountId ?? null,
    })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Failed' }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'AR settings',
  methods: {
    GET: {
      summary: 'Read the AR posting accounts for the active organization',
      tags: [orvaFinanceTag],
      responses: [{ status: 200, description: 'Current AR settings.', schema: settingsResponseSchema }],
    },
    PUT: {
      summary: 'Set the AR posting accounts (AR=asset, revenue=income, tax=liability)',
      tags: [orvaFinanceTag],
      requestBody: { schema: arSettingsPutSchema },
      responses: [{ status: 200, description: 'Updated AR settings.', schema: settingsResponseSchema }],
    },
  },
}
