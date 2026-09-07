import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_tasking.view'] },
}

const assigneeSchema = z.object({ id: z.string(), name: z.string() })

/**
 * Who a task can be assigned to.
 *
 * Deliberately this module's own route rather than `/api/auth/users`, which is
 * gated on `auth.users.list` — an employee who may plan work should not need
 * permission to enumerate the tenant's user accounts to fill in a picker. This
 * returns two fields and nothing else.
 *
 * Names come through `findWithDecryption`: `users.name` and `users.email` are
 * encrypted at rest, so a raw select would hand the picker ciphertext.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const items = await withTenantRls(em, auth.tenantId, async (tem) => {
    // Users attached to this organization, plus tenant-wide accounts that carry
    // no organization of their own.
    const users = await findWithDecryption(tem, User, {
      tenantId: auth.tenantId!,
      deletedAt: null,
      $or: [{ organizationId }, { organizationId: null }],
    })
    return users
      .map((user) => ({ id: user.id, name: user.name || user.email }))
      .sort((a, b) => a.name.localeCompare(b.name, 'th'))
  })
  return Response.json({ items })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Tasking',
  summary: 'Assignable people',
  methods: {
    GET: {
      summary: 'Id and display name of the people a task can be assigned to',
      tags: ['Orva Tasking'],
      responses: [{ status: 200, description: 'People.', schema: z.object({ items: z.array(assigneeSchema) }) }],
    },
  },
}
