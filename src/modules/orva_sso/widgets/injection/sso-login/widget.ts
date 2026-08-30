import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import SsoLoginWidget from './widget.client'

/**
 * Headless-looking (renders nothing visible) login-form widget that drives
 * the auth.login:form AuthOverride contract: when the typed email's domain
 * has an enabled SSO connection, the password field is replaced by a
 * "Continue with SSO" action that starts the OIDC flow.
 */
const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'orva_sso.injection.sso-login',
    title: 'Orva SSO login discovery',
    description:
      'Watches the login email field and swaps the password submit for an SSO redirect when the email domain has an enabled OIDC connection.',
    priority: 100,
    enabled: true,
  },
  Widget: SsoLoginWidget as never,
}

export default widget
