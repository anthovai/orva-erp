import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import PortalWorkWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'orva_tasking.injection.portal-work',
    title: 'Work progress',
    description: "Progress of the projects shared with this customer, with a link into the full list.",
    requiredModules: ['portal'],
    priority: 5,
    enabled: true,
  },
  Widget: PortalWorkWidget,
}

export default widget
