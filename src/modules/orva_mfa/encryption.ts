import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

// TOTP secrets are credentials: encrypted at rest via the platform's
// declarative map. Reads must go through findOneWithDecryption/findWithDecryption.
export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'orva_mfa:totp_credential',
    fields: [{ field: 'secret' }],
  },
]

export default defaultEncryptionMaps
