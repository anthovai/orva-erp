import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { SsoConnection } from '../../data/entities'
import { discoverQuerySchema } from '../../data/validators'
import { domainsMatchEmail } from '../../lib/oidc'

export const metadata = {
  GET: { requireAuth: false },
}

const responseSchema = z.object({ sso: z.boolean() })

/**
 * Pre-auth SSO discovery for the login form. Deliberately leaks nothing but
 * a boolean: whether some enabled connection claims the email's domain.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const parsed = discoverQuerySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const connections = await em.find(SsoConnection, { enabled: true, deletedAt: null })
  const match = connections.some((connection) => domainsMatchEmail(connection.emailDomains, parsed.data.email))
  return Response.json({ sso: match })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva SSO',
  summary: 'SSO discovery',
  methods: {
    GET: {
      summary: 'Whether an enabled SSO connection claims this email domain',
      tags: ['Orva SSO'],
      query: discoverQuerySchema,
      responses: [{ status: 200, description: 'Boolean only.', schema: responseSchema }],
      errors: [{ status: 400, description: 'Invalid query', schema: z.object({ error: z.string() }) }],
    },
  },
}
