import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateFinanceOverviewSettings, type FinanceOverviewSettings } from './config'

const FinanceOverviewWidget = lazyDashboardWidget(() => import('./widget.client'))

/**
 * The number an operator opens an ERP to see: what came in, what is left
 * after costs, and how much money is stuck on either side of the ledger.
 * Reads the same posted-journal reports as /backend/gl/statements and
 * /backend/reports/aging, so the dashboard can never disagree with them.
 */
const widget: DashboardWidgetModule<FinanceOverviewSettings> = {
  metadata: {
    id: 'orva_finance.dashboard.overview',
    title: 'Financial overview',
    description: 'Revenue, net profit and outstanding receivables/payables from posted journals.',
    features: ['dashboards.view', 'orva_finance.gl.view'],
    defaultSize: 'lg',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
    tags: ['finance', 'orva'],
    category: 'orva_finance',
    icon: 'bar-chart-3',
    supportsRefresh: true,
  },
  Widget: FinanceOverviewWidget,
  hydrateSettings: hydrateFinanceOverviewSettings,
  dehydrateSettings: (settings) => ({ range: settings.range }),
}

export default widget
