import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { badRequest, conflict } from '@open-mercato/shared/lib/crud/errors'
import { Party, PartyRole } from '../data/entities'

type Scope = { tenantId: string | null | undefined; organizationId: string | null | undefined }

/**
 * The party a write names must be one the caller can already see.
 *
 * `partyId` arrives in the request body on both the role and the link route,
 * and the CRUD factory stamps the NEW row with the caller's own tenant and
 * organization — it never checks the row the body points AT. So without this,
 * a caller could mint a vendor-role row inside their own organization that
 * references somebody else's party. The framework rule is the flat one:
 * never trust scope that came from the payload.
 *
 * Today the tenant has a single organization, so nothing can reach across
 * one. That is a fact about the data, not a property of the code, and it
 * stops being true the first time a second organization exists — which is the
 * stated direction for this app.
 *
 * A party outside the caller's scope is reported as simply not existing.
 * Distinguishing "not yours" from "no such thing" would confirm that the id
 * names something real.
 */
export async function assertPartyInScope(
  container: AwilixContainer,
  scope: Scope,
  partyId: string,
): Promise<void> {
  if (!scope.tenantId) throw badRequest('ไม่พบคู่ค้ารายนี้')
  const em = container.resolve<EntityManager>('em')
  const party = await em.findOne(Party, {
    id: partyId,
    tenantId: scope.tenantId,
    ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
    deletedAt: null,
  })
  if (!party) throw badRequest('ไม่พบคู่ค้ารายนี้')
}

/**
 * One active role of a kind per party.
 *
 * `orva_party_roles_active_unique` already enforces this in the database, but
 * a raw unique violation is not a `CrudHttpError`, and the CRUD factory maps
 * anything it does not recognise to a bare 500 — "Something went wrong.
 * Please try again later." So registering a vendor that was already a vendor
 * looked like the server breaking rather than like a duplicate.
 *
 * The index stays the real guard, including against two requests racing. This
 * only makes the ordinary case say what happened.
 *
 * Deliberately scoped to `deletedAt: null`: the index is partial for the same
 * reason, so a role that was revoked can be granted again when a vendor comes
 * back.
 */
export async function assertRoleNotAlreadyHeld(
  container: AwilixContainer,
  scope: Scope,
  partyId: string,
  role: string,
): Promise<void> {
  if (!scope.tenantId) return
  const em = container.resolve<EntityManager>('em')
  const existing = await em.findOne(PartyRole, {
    partyId,
    role,
    tenantId: scope.tenantId,
    ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
    deletedAt: null,
  })
  if (existing) throw conflict('คู่ค้ารายนี้มีบทบาทนี้อยู่แล้ว')
}
