import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { monthPackDownloadSchema } from '../../../../data/validators'
import { buildPack, recordPack } from '../../../../lib/monthPackRender'
import { orvaFinanceTag } from '../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_finance.gl.view'] },
}

/** Streams the month pack as a zip and records that it was generated. */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = monthPackDownloadSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const built = await withTenantRls(em, scope.tenantId, async (tem) => {
      const pack = await buildPack(req, tem, scope, parsed.data.month, parsed.data.pdf !== '0')
      recordPack(tem, scope, pack, { status: 'generated', createdBy: auth.sub ?? null })
      await tem.flush()
      return pack
    })
    return new Response(built.zip as BodyInit, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-length': String(built.zip.byteLength),
        'content-disposition': `attachment; filename="month-pack-${parsed.data.month}.zip"; filename*=UTF-8''${encodeURIComponent(built.fileName)}`,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not build the month pack' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'Month pack download',
  methods: {
    GET: {
      summary: 'Build and download the ชุดปิดเดือน zip for one month',
      description: 'CSV registers, journal, ledger, trial balances, statements, bank reconciliation and (pdf=1, default) the tax-document PDFs.',
      tags: [orvaFinanceTag],
      query: monthPackDownloadSchema,
      responses: [{ status: 200, description: 'The zip file.', mediaType: 'application/zip' }],
      errors: [
        { status: 400, description: 'Invalid query', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
