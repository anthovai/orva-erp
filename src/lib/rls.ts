import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * Orva hardening: run `fn` inside a transaction whose queries are subject to
 * database-level tenant isolation (PostgreSQL RLS).
 *
 * Sets the transaction-local GUC `orva.tenant_id` that the
 * `orva_tenant_isolation` policies check: inside the callback, rows of other
 * tenants are invisible and unwritable at the database level, even if a query
 * forgets its WHERE clause. Outside such a transaction the policies are
 * fail-open and application-level scoping is the only guard.
 *
 * Every @orva/* command or service that touches tenant data SHOULD wrap its
 * database work in this helper. Pass the request-scoped EntityManager; the
 * callback receives the transactional fork to use for all queries.
 */
export async function withTenantRls<T>(
  em: EntityManager,
  tenantId: string,
  fn: (tem: EntityManager) => Promise<T>,
): Promise<T> {
  if (!tenantId) throw new Error('[internal] withTenantRls requires a tenantId')
  return em.transactional(async (tem) => {
    // set_config(..., true) = SET LOCAL: scoped to this transaction, so the
    // pooled connection carries nothing over to the next request.
    await tem.execute(`select set_config('orva.tenant_id', ?, true)`, [tenantId])
    return fn(tem)
  })
}
