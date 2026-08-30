import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { GlAccount } from '@/modules/orva_finance/data/entities'
import { HrSettings } from '../../data/entities'
import { hrSettingsPutSchema } from '../../data/validators'
import { orvaHrTag } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_hr.payroll.view'] },
  PUT: { requireAuth: true, requireFeatures: ['orva_hr.payroll.manage'] },
}

const settingsResponseSchema = z.object({
  salaryExpenseAccountId: z.string().uuid().nullable(),
  ssoExpenseAccountId: z.string().uuid().nullable(),
  ssoPayableAccountId: z.string().uuid().nullable(),
  taxPayableAccountId: z.string().uuid().nullable(),
  netPayableAccountId: z.string().uuid().nullable(),
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const settings = await em.findOne(HrSettings, { tenantId: auth.tenantId, organizationId })
  return Response.json({
    salaryExpenseAccountId: settings?.salaryExpenseAccountId ?? null,
    ssoExpenseAccountId: settings?.ssoExpenseAccountId ?? null,
    ssoPayableAccountId: settings?.ssoPayableAccountId ?? null,
    taxPayableAccountId: settings?.taxPayableAccountId ?? null,
    netPayableAccountId: settings?.netPayableAccountId ?? null,
  })
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = hrSettingsPutSchema.safeParse(await readJsonSafe(req))
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
      await expectType(parsed.data.salaryExpenseAccountId, 'expense', 'Salary expense')
      await expectType(parsed.data.ssoExpenseAccountId, 'expense', 'SSO expense')
      await expectType(parsed.data.ssoPayableAccountId, 'liability', 'SSO payable')
      await expectType(parsed.data.taxPayableAccountId, 'liability', 'Tax payable')
      await expectType(parsed.data.netPayableAccountId, 'liability', 'Net payable')

      const existing = await tem.findOne(HrSettings, { tenantId, organizationId })
      if (existing) {
        Object.assign(existing, parsed.data)
      } else {
        const now = new Date()
        tem.persist(tem.create(HrSettings, { tenantId, organizationId, ...parsed.data, createdAt: now, updatedAt: now }))
      }
      await tem.flush()
    })
    return Response.json(parsed.data)
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Failed' }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaHrTag,
  summary: 'Payroll GL settings',
  methods: {
    GET: {
      summary: 'Read the payroll posting accounts for the active organization',
      tags: [orvaHrTag],
      responses: [{ status: 200, description: 'Current HR settings.', schema: settingsResponseSchema }],
    },
    PUT: {
      summary: 'Set the payroll posting accounts (expenses + payables, type-validated)',
      tags: [orvaHrTag],
      requestBody: { schema: hrSettingsPutSchema },
      responses: [{ status: 200, description: 'Updated HR settings.', schema: settingsResponseSchema }],
    },
  },
}
