import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  // Under the upstream debugging/cache panel on ตั้งค่าระบบ → สถานะระบบ: that
  // page already answers "how is the server behaving", so "can the business
  // actually work" belongs beside it rather than on a screen of its own.
  'configs.system_status:details': [
    { widgetId: 'orva.injection.readiness', priority: 10 },
  ],
}

export default injectionTable
