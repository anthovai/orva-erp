import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'auth.login:form': [
    {
      widgetId: 'orva_sso.injection.sso-login',
      priority: 100,
    },
  ],
}

export default injectionTable
