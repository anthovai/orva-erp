import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * One static object literal, no branching: the fact extractor can only fold a
 * statically known value, so a table built by a ternary publishes nothing.
 *
 * `portal:dashboard:sections` rather than `portal:dashboard:after`, because
 * that is the spot the portal dashboard actually renders its widget list into
 * — `:after` puts the card below the whole page. The widget is inert when the
 * portal module is absent, gated by `requiredModules` on the widget itself.
 */
export const injectionTable: ModuleInjectionTable = {
  'portal:dashboard:sections': [
    { widgetId: 'orva_tasking.injection.portal-work', priority: 5 },
  ],
}

export default injectionTable
