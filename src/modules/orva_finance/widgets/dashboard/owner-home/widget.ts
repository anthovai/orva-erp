import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateOwnerHomeSettings, type OwnerHomeSettings } from './config'

const OwnerHomeWidget = lazyDashboardWidget(() => import('./widget.client'))

/**
 * The one screen a one-person company opens each day. Four questions:
 * what money is due in, what came in this month, which tax filings are
 * next, and what is waiting on somebody. Spec:
 * .ai/specs/2026-09-03-orva-for-kaiser-klowns-operating-model.md
 */
const widget: DashboardWidgetModule<OwnerHomeSettings> = {
  metadata: {
    id: 'orva_finance.dashboard.owner_home',
    title: 'วันนี้ต้องดูอะไร',
    description: 'เงินที่จะเข้า เงินเข้าเดือนนี้ ภาษีที่ใกล้ถึงกำหนด และเอกสารที่รอ — จากตัวเลขชุดเดียวกับรายงาน',
    features: ['dashboards.view', 'orva_finance.gl.view'],
    defaultSize: 'lg',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['finance', 'orva', 'home'],
    category: 'orva_finance',
    icon: 'layout-dashboard',
    supportsRefresh: true,
  },
  Widget: OwnerHomeWidget,
  hydrateSettings: hydrateOwnerHomeSettings,
  dehydrateSettings: (settings) => ({ showInvoiceList: settings.showInvoiceList }),
}

export default widget
