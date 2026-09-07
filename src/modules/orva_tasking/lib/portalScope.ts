import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  getCustomerAuthFromRequest,
  type CustomerAuthContext,
} from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'

export type PortalScope = {
  auth: CustomerAuthContext
  tenantId: string
  organizationId: string
  /** The company this signed-in person belongs to. Never from the request. */
  customerEntityId: string
  em: EntityManager
}

/**
 * Who is asking, on the portal side.
 *
 * Every scope value — tenant, organization and customer — comes from the
 * session record. None of them is ever read from the query string or the body,
 * because a caller who can name their own customer id can name someone
 * else's.
 *
 * A session with no `customerEntityId` is refused rather than served
 * unscoped: there is no safe way to answer "show me my projects" for an
 * account that belongs to no company.
 */
export async function resolvePortalScope(req: Request): Promise<PortalScope | Response> {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.customerEntityId) {
    return Response.json({ error: 'บัญชีนี้ยังไม่ได้ผูกกับบริษัทลูกค้า' }, { status: 403 })
  }
  if (!auth.resolvedFeatures?.includes('orva_tasking.portal.view')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  const container = await createRequestContainer()
  return {
    auth,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    customerEntityId: auth.customerEntityId,
    em: container.resolve<EntityManager>('em'),
  }
}

export function isResponse(value: unknown): value is Response {
  return value instanceof Response
}
