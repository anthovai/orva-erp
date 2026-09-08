import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

/**
 * The vendor snapshot holds a counterparty's registered name, taxpayer id and
 * address — and for a freelance subcontractor that is a person's name and
 * home address. Encrypted at rest through the platform's declarative map, the
 * same treatment sales gives `customer_snapshot`.
 *
 * Consequence, and the reason this comment exists: a raw SQL select returns
 * ciphertext. Every read of `vendor_snapshot` goes through
 * `findOneWithDecryption` (see lib/documentSource.ts). The list and detail
 * queries deliberately do not select it at all — they join the live party for
 * a display name instead.
 */
export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'orva_purchasing:purchase_order',
    fields: [{ field: 'vendor_snapshot' }],
  },
]

export default defaultEncryptionMaps
