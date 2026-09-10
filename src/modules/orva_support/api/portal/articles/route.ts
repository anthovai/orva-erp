import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { SupportArticle } from '../../../data/entities'
import { portalArticleQuerySchema } from '../../../data/validators'
import { excerpt, matchesSearch } from '../../../lib/articles'

// The route authenticates the customer itself; staff auth does not apply.
export const metadata = {
  GET: { requireAuth: false },
}

const portalArticleSchema = z.object({
  slug: z.string(), title: z.string(), summary: z.string(), tags: z.array(z.string()),
  body: z.string().optional(), updatedAt: z.string(),
})

/**
 * What a signed-in customer may read: the published articles of their own
 * organization, and nothing else. Scope comes from the session — never from
 * the query — so a customer of one tenant cannot name another's article. A
 * slug returns that one article with its body; without a slug the list comes
 * back with summaries only.
 */
export async function GET(req: Request) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = portalArticleQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const rows = await withTenantRls(em, scope.tenantId, (tem) => tem.find(
    SupportArticle,
    { ...scope, deletedAt: null, isPublished: true },
    { orderBy: { position: 'asc', title: 'asc' } },
  ))

  if (parsed.data.slug) {
    const row = rows.find((article) => article.slug === parsed.data.slug)
    if (!row) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({
      item: {
        slug: row.slug, title: row.title, summary: row.summary ?? excerpt(row.body), tags: row.tags ?? [],
        body: row.body, updatedAt: row.updatedAt.toISOString(),
      },
    })
  }

  const items = rows
    .filter((row) => matchesSearch(row, parsed.data.search ?? ''))
    .map((row) => ({
      slug: row.slug, title: row.title, summary: row.summary ?? excerpt(row.body),
      tags: row.tags ?? [], updatedAt: row.updatedAt.toISOString(),
    }))
  return Response.json({ items })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Support',
  summary: 'Knowledge base (customer portal)',
  methods: {
    GET: {
      summary: "Published articles of the signed-in customer's organization; with ?slug= one article and its body",
      tags: ['Orva Support'],
      query: portalArticleQuerySchema,
      responses: [{ status: 200, description: 'Articles.', schema: z.object({ items: z.array(portalArticleSchema).optional(), item: portalArticleSchema.optional() }) }],
      errors: [{ status: 401, description: 'Customer sign-in required', schema: z.object({ error: z.string() }) }],
    },
  },
}
