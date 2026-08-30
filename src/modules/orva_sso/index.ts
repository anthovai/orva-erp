import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'orva_sso',
  title: 'Orva SSO',
  version: '0.1.0',
  description:
    'Clean-room OIDC single sign-on: per-tenant IdP connections matched by email domain, authorization-code + PKCE flow with ID-token verification via JWKS, sessions issued through the documented public auth sequence. Existing users only — no JIT provisioning.',
  author: 'Anthovai',
  license: 'MIT',
}

export { features } from './acl'
