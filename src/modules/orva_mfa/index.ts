import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'orva_mfa',
  title: 'Orva MFA',
  version: '0.1.0',
  description:
    'Clean-room TOTP multi-factor authentication: authenticator enrollment with recovery codes, a login step-up challenge that swaps the issued token for a short-lived pending token, and a global backend gate. Built only on public extension points.',
  author: 'Anthovai',
  license: 'MIT',
}

export { features } from './acl'
