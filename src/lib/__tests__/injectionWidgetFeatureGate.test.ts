import { describe, expect, it } from '@jest/globals'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * An injection widget must NOT declare `features` in its metadata.
 *
 * The two widget systems check features differently, and only one of them
 * knows what a superadmin is:
 *
 *   dashboards/lib/access.ts →  authorizeFeatures(widget.metadata.features, {
 *                                 grantedFeatures: ctx.features,
 *                                 unrestricted: ctx.isSuperAdmin,   // ← bypass
 *                               })
 *
 *   ui/backend/injection/InjectionSpot →  hasAllFeatures(chrome.grantedFeatures,
 *                                                        widget.metadata.features)
 *
 * `hasAllFeatures` has no bypass and is literal:
 *
 *   if (!Array.isArray(granted) || !granted.length) return false
 *
 * and `/api/auth/admin/nav` returns `grantedFeatures: []` for a superadmin —
 * their access is a server-side bypass, not a list of grants. So a `features`
 * gate on an injection widget hides it from the tenant owner while every
 * ordinary employee with the explicit grant still sees it.
 *
 * That is not a theory. `orva_documents.injection.quote-documents` carried
 * `features: ['orva_documents.view']` and its Review button never once
 * appeared on the quote screen; so did the งวด list and the quote-list row
 * actions. The owner reported it as "this was never built".
 *
 * The gate bought nothing anyway: the page is behind its own
 * `requireFeatures`, and every route a widget calls checks features
 * server-side. If a widget really must be hidden from some staff, gate it
 * INSIDE the component on something the client actually has — `roles` is on
 * the backend chrome next to `grantedFeatures`.
 *
 * See `.ai/lessons/superadmin-client-grantedfeatures-is-empty.md`.
 */

const MODULES_DIR = join(__dirname, '..', '..', 'modules')

function injectionWidgetFiles(): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '__tests__') continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name === 'widget.ts' && path.split(sep).includes('injection')) found.push(path)
    }
  }
  for (const name of readdirSync(MODULES_DIR)) {
    if (!name.startsWith('orva')) continue
    const widgets = join(MODULES_DIR, name, 'widgets')
    try { if (statSync(widgets).isDirectory()) walk(widgets) } catch { /* module has no widgets */ }
  }
  return found
}

describe('an injection widget is not gated on features the owner does not have', () => {
  it('finds the app’s injection widgets at all', () => {
    // A rename that empties this list would make the rule below vacuous.
    expect(injectionWidgetFiles().length).toBeGreaterThan(0)
  })

  it('declares no `features` in any Orva injection widget’s metadata', () => {
    const offenders = injectionWidgetFiles()
      .map((file) => ({ file, source: readFileSync(file, 'utf8') }))
      .filter(({ source }) => /^\s*features\s*:\s*\[/m.test(source))
      .map(({ file }) => relative(join(__dirname, '..', '..', '..'), file).split(sep).join('/'))

    if (offenders.length) {
      throw new Error(
        'These injection widgets declare a feature gate, which hides them from the superadmin ' +
        '(grantedFeatures is [] for that account) while showing them to everyone else:\n' +
        offenders.map((f) => `  - ${f}`).join('\n') +
        '\nGate inside the component on `roles` if it truly must be hidden.',
      )
    }
    expect(offenders).toEqual([])
  })
})
