import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'

/**
 * The name the desk queue shows for a ticket's customer.
 *
 * Denormalised onto the ticket at creation so a list row needs no decryption
 * round trip — and read through `findWithDecryption` here, because the CRM
 * display name is an encrypted column and raw SQL would hand back ciphertext.
 * Both doors onto a ticket (the queue screen and the customer portal) call
 * this, so one ticket reads the same whichever opened it.
 */
export async function customerNameFor(
  tem: EntityManager,
  scope: { tenantId: string; organizationId: string },
  entityId: string | null | undefined,
): Promise<string | null> {
  if (!entityId) return null
  const [entity] = await findWithDecryption(
    tem, CustomerEntity, { id: entityId }, {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  return (entity as { displayName?: string | null } | undefined)?.displayName ?? null
}
