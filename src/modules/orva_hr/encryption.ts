import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

/**
 * An employment record holds the four facts that hurt most when they leak: the
 * national id, the social-security number, the home address and the bank
 * account the salary lands in. They are encrypted at rest through the
 * platform's declarative map, the same treatment `customers` gives a person's
 * profile.
 *
 * `display_name` is deliberately NOT encrypted: it is the snapshot payslips and
 * GL lines read without a cross-module join, and the module was designed that
 * way before this. The Thai given/family names are the same person's name in a
 * second shape, so they follow the display name rather than the secrets.
 *
 * Consequence, and the reason this comment exists: raw SQL and the query index
 * return CIPHERTEXT for the four fields below. The statutory reads go through
 * `findWithDecryption` (lib/statutory.ts), and the employee list index does not
 * carry them at all.
 */
export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'orva_hr:hr_employee',
    fields: [
      { field: 'national_id' },
      { field: 'sso_number' },
      { field: 'address' },
      { field: 'bank_account_no' },
    ],
  },
]

export default defaultEncryptionMaps
