import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

// The OIDC client secret is a credential — encrypted at rest via the
// platform's declarative map; reads go through findOneWithDecryption.
export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'orva_sso:sso_connection',
    fields: [{ field: 'client_secret' }],
  },
]

export default defaultEncryptionMaps
