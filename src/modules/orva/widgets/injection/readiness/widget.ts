import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ReadinessWidget from './widget.client'

/** ความพร้อมใช้งาน, under the upstream system-status panel. */
const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'orva.injection.readiness',
    title: 'Operational readiness',
    description: 'Whether the tenant can bill, post and send: the settings and environment facts that each live on a different screen.',
    priority: 10,
    enabled: true,
    // No `features` gate — see src/lib/__tests__/injectionWidgetFeatureGate.test.ts:
    // the injection path checks the client's granted list, which is empty for
    // a superadmin. The route behind this widget checks its own feature.
  },
  Widget: ReadinessWidget as never,
}

export default widget
