import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { GlAccount, GlSettings } from '../../../data/entities'
import { glSettingsPutSchema } from '../../../data/validators'
import { orvaFinanceTag } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_finance.gl.view'] },
  PUT: { requireAuth: true, requireFeatures: ['orva_finance.gl.manage'] },
}

const settingsResponseSchema = z.object({
  retainedEarningsAccountId: z.string().uuid().nullable(),
  accountantEmail: z.string().nullable(),
  accountantName: z.string().nullable(),
})

const toResponse = (settings: GlSettings | null) => ({
  retainedEarningsAccountId: settings?.retainedEarningsAccountId ?? null,
  accountantEmail: settings?.accountantEmail ?? null,
  accountantName: settings?.accountantName ?? null,
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const settings = await em.findOne(GlSettings, { tenantId: auth.tenantId, organizationId })
  return Response.json(toResponse(settings))
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = glSettingsPutSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    await withTenantRls(em, tenantId, async (tem) => {
      const account = await tem.findOne(GlAccount, { id: parsed.data.retainedEarningsAccountId, tenantId, deletedAt: null })
      if (!account) throw Object.assign(new Error('Account not found'), { status: 400 })
      if (account.accountType !== 'equity') {
        throw Object.assign(new Error('Retained earnings must be an equity account'), { status: 400 })
      }
      const existing = await tem.findOne(GlSettings, { tenantId, organizationId })
      const accountant = {
        // omitted = keep; null/'' = clear
        ...(parsed.data.accountantEmail !== undefined ? { accountantEmail: parsed.data.accountantEmail || null } : {}),
        ...(parsed.data.accountantName !== undefined ? { accountantName: parsed.data.accountantName || null } : {}),
      }
      if (existing) {
        existing.retainedEarningsAccountId = parsed.data.retainedEarningsAccountId
        Object.assign(existing, accountant)
        await tem.flush()
        return existing
      }
      const now = new Date()
      const created = tem.create(GlSettings, {
        tenantId,
        organizationId,
        retainedEarningsAccountId: parsed.data.retainedEarningsAccountId,
        accountantEmail: null,
        accountantName: null,
        ...accountant,
        createdAt: now,
        updatedAt: now,
      })
      tem.persist(created)
      await tem.flush()
      return created
    })
    const settings = await em.fork().findOne(GlSettings, { tenantId, organizationId })
    return Response.json(toResponse(settings))
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Failed' }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'GL settings',
  methods: {
    GET: {
      summary: 'Read the retained-earnings account for the active organization',
      tags: [orvaFinanceTag],
      responses: [{ status: 200, description: 'Current GL settings.', schema: settingsResponseSchema }],
    },
    PUT: {
      summary: 'Set the retained-earnings account (must be equity)',
      tags: [orvaFinanceTag],
      requestBody: { schema: glSettingsPutSchema },
      responses: [{ status: 200, description: 'Updated GL settings.', schema: settingsResponseSchema }],
    },
  },
}
