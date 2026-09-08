import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { settingsPutSchema } from '../../data/validators'
import { loadSettings } from '../../lib/orders'
import { formatPoNumber, periodKeyFor, seqAppliesTo } from '../../lib/numbering'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_purchasing.view'] },
  PUT: { requireAuth: true, requireFeatures: ['orva_purchasing.manage'] },
}

const settingsSchema = z.object({
  poNumberFormat: z.string(),
  vatDefault: z.string(),
  defaultGoodsAccountId: z.string().nullable(),
  defaultServiceAccountId: z.string().nullable(),
  /** What the next send would produce — the format made concrete. */
  nextPoNumber: z.string(),
  updatedAt: z.string(),
})

const present = (settings: {
  poNumberFormat: string
  vatDefault: string
  defaultGoodsAccountId?: string | null
  defaultServiceAccountId?: string | null
  poSeqPeriod?: string | null
  nextPoSeq: string
  updatedAt: Date
}) => {
  const today = new Date()
  const seq = seqAppliesTo({ storedPeriod: settings.poSeqPeriod ?? null, format: settings.poNumberFormat, date: today })
    ? Number(settings.nextPoSeq)
    : 1
  return {
    poNumberFormat: settings.poNumberFormat,
    vatDefault: settings.vatDefault,
    defaultGoodsAccountId: settings.defaultGoodsAccountId ?? null,
    defaultServiceAccountId: settings.defaultServiceAccountId ?? null,
    nextPoNumber: formatPoNumber(settings.poNumberFormat, { date: today, seq }),
    updatedAt: settings.updatedAt.toISOString(),
  }
}

/** Numbering and the accounts a new line defaults to. Created on first read. */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const settings = await withTenantRls(em, scope.tenantId, (tem) => loadSettings(tem, scope))
  return Response.json(present(settings))
}

/**
 * Changes the format or the defaults.
 *
 * Editing the format does not renumber anything already sent, and the stored
 * period key is left alone: `periodKeyFor` compares the *new* format against
 * it, so a format change that implies a different period simply starts a new
 * run at 1 rather than continuing somebody else's count.
 */
export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = settingsPutSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  if (input.poNumberFormat && !/\{seq(:\d+)?\}/.test(input.poNumberFormat)) {
    return Response.json({ error: 'รูปแบบเลขที่ต้องมี {seq} หรือ {seq:4}' }, { status: 400 })
  }
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const saved = await withTenantRls(em, scope.tenantId, async (tem) => {
    const settings = await loadSettings(tem, scope)
    if (input.poNumberFormat !== undefined) settings.poNumberFormat = input.poNumberFormat
    if (input.vatDefault !== undefined) settings.vatDefault = input.vatDefault
    if (input.defaultGoodsAccountId !== undefined) settings.defaultGoodsAccountId = input.defaultGoodsAccountId
    if (input.defaultServiceAccountId !== undefined) settings.defaultServiceAccountId = input.defaultServiceAccountId
    settings.updatedAt = new Date()
    await tem.flush()
    return settings
  })
  return Response.json({ ok: true, ...present(saved) })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Purchasing',
  summary: 'Purchasing settings',
  methods: {
    GET: {
      summary: 'Number format, VAT default and the accounts a new line uses',
      tags: ['Orva Purchasing'],
      responses: [{ status: 200, description: 'Settings.', schema: settingsSchema }],
    },
    PUT: {
      summary: 'Change the number format or the defaults',
      tags: ['Orva Purchasing'],
      requestBody: { schema: settingsPutSchema },
      responses: [{ status: 200, description: 'Saved.', schema: settingsSchema.extend({ ok: z.literal(true) }) }],
      errors: [{ status: 400, description: 'A format with no sequence token', schema: z.object({ error: z.string() }) }],
    },
  },
}
