import { describe, expect, it } from '@jest/globals'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The sidebar is one list, written in two places.
 *
 * Our own pages declare `pageGroup`/`pageOrder` in their `page.meta.ts`.
 * Upstream pages are moved into the same groups by `regroup`/`place` calls in
 * `src/modules.ts`. Neither side can see the other, so the orders drifted into
 * each other: `customers/deals` and `sales/invoices` were both "sales 10",
 * `wms/inventory` and `stock/valuation` both sat at 30, and two Stock pages
 * shipped as 30 outright. Ties fall back to insertion order, so the sidebar
 * arranged itself differently depending on which module registered first —
 * invisible in review and impossible to reason about.
 *
 * This test reads both sides and holds three rules:
 *
 *   1. No two pages share a group and an order.
 *   2. Every group named by either side has a label to render.
 *   3. No group is a wall — see MAX_ITEMS_PER_GROUP for where that line is
 *      drawn and why it sits where it does.
 *
 * It is deliberately not a snapshot of the current arrangement — moving a page
 * between groups is ordinary work and should not need a test updated. Only
 * these three properties are fixed.
 *
 * **What it cannot see.** It reads the two files above, and a group can also
 * arrive from neither: an installed module whose pages declare no group at all
 * gets one named after the module. That is how "Media" (the attachment
 * library) and "Business rules" (its log) were still heading groups of one
 * each after this test passed — both only turned up on screen, counted in the
 * rendered sidebar. Fixed by folding them into Settings, but the blind spot is
 * real: this file checks the configuration, not the menu. Count the headings
 * in a browser before believing the sidebar is what you meant.
 */

const ROOT = join(__dirname, '..', '..', '..')
const MODULES_DIR = join(ROOT, 'src', 'modules')
const MODULES_TS = join(ROOT, 'src', 'modules.ts')
const TH = join(MODULES_DIR, 'orva', 'i18n', 'th.json')
const EN = join(MODULES_DIR, 'orva', 'i18n', 'en.json')

/**
 * Where a group stops being a list and becomes a wall.
 *
 * Ten, not because ten is principled, but because it is the smallest number
 * that does not force a change nobody wants. โปรเจกต์และงาน sits exactly on it:
 * our own board (4), the billing view for those projects, and five installed
 * pages — calendar, two other task surfaces and two timesheet screens. Three
 * overlapping task lists is a real tension, but it is upstream's shape, and
 * `nav-project-group.test.ts` exists because hiding pages out of that group is
 * precisely what went wrong four times in one sitting.
 *
 * The number this rule is actually aimed at is nineteen, which is what
 * บัญชี held before Reports & Tax was split out of it.
 */
const MAX_ITEMS_PER_GROUP = 10

type Entry = { where: string; route: string; groupKey: string; order: number }

/** `…/orva_documents/backend/sales/invoices/page.meta.ts` → `/backend/sales/invoices` */
const routeOf = (path: string): string =>
  '/backend/' + path.split('/backend/')[1].replace('/page.meta.ts', '')

/** Our own pages: one `page.meta.ts` each. */
function fromPageMeta(): Entry[] {
  const found: Entry[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) { walk(path); continue }
      if (name !== 'page.meta.ts') continue
      const source = readFileSync(path, 'utf8')
      if (/navHidden:\s*true/.test(source)) continue
      const groupKey = /pageGroupKey:\s*'([^']+)'/.exec(source)?.[1]
      const order = /pageOrder:\s*(\d+)/.exec(source)?.[1]
      if (!groupKey || !order) continue
      const where = path.slice(path.indexOf('src')).split('\\').join('/')
      found.push({ where, route: routeOf(where), groupKey, order: Number(order) })
    }
  }
  for (const name of readdirSync(MODULES_DIR)) {
    if (!name.startsWith('orva')) continue
    const backend = join(MODULES_DIR, name, 'backend')
    try { if (statSync(backend).isDirectory()) walk(backend) } catch { /* module has no screens */ }
  }
  return found
}

/** Upstream pages: `regroup('group', n)` / `place('group', n)` in modules.ts. */
function fromModulesTs(): { entries: Entry[]; navKeys: Record<string, string> } {
  const source = readFileSync(MODULES_TS, 'utf8')
  const navKeys: Record<string, string> = {}
  for (const m of source.matchAll(/(\w+):\s*\{\s*pageGroup:\s*'[^']*',\s*pageGroupKey:\s*'([^']+)'\s*\}/g)) {
    navKeys[m[1]] = m[2]
  }
  const entries: Entry[] = []
  for (const m of source.matchAll(/'(\/backend\/[^']+)':\s*(?:regroup|place)\('(\w+)',\s*(\d+)\)/g)) {
    const groupKey = navKeys[m[2]]
    if (!groupKey) continue
    entries.push({ where: `src/modules.ts → ${m[1]}`, route: m[1], groupKey, order: Number(m[3]) })
  }
  return { entries, navKeys }
}

const all = (): Entry[] => [...fromPageMeta(), ...fromModulesTs().entries]

describe('the sidebar is one coherent list', () => {
  it('reads both sides of it', () => {
    // If either reader stopped matching, every rule below would pass by
    // having nothing to compare.
    expect(fromPageMeta().length).toBeGreaterThan(30)
    expect(fromModulesTs().entries.length).toBeGreaterThan(20)
    expect(Object.keys(fromModulesTs().navKeys).length).toBeGreaterThan(5)
  })

  it('places a page in one place, whichever side says so', () => {
    // A route our own module owns can ALSO be named by a modules.ts override.
    // That is allowed and sometimes necessary — but the two must agree, since
    // only one of them wins and which one is not visible from either file.
    const byRoute = new Map<string, Entry[]>()
    for (const entry of all()) {
      byRoute.set(entry.route, [...(byRoute.get(entry.route) ?? []), entry])
    }
    const disagreements: string[] = []
    for (const [route, entries] of byRoute) {
      const slots = new Set(entries.map((e) => `${e.groupKey} #${e.order}`))
      if (slots.size > 1) {
        disagreements.push(
          `${route}\n      ${entries.map((e) => `${e.where} says ${e.groupKey} #${e.order}`).join('\n      ')}`,
        )
      }
    }
    if (disagreements.length) {
      throw new Error(
        'These routes are positioned in two places and the two disagree. Only one\n' +
        'wins, and which is not visible from either file:\n\n' +
        disagreements.map((d) => `  - ${d}`).join('\n\n'),
      )
    }

    const seen = new Map<string, string>()
    const clashes: string[] = []
    for (const [route, entries] of byRoute) {
      const slot = `${entries[0].groupKey} #${entries[0].order}`
      const first = seen.get(slot)
      if (first) clashes.push(`${slot}\n      ${first}\n      ${route}`)
      else seen.set(slot, route)
    }
    if (clashes.length) {
      throw new Error(
        `These pages share a group and an order, so which comes first depends on\n` +
        `module registration order rather than on anything anyone decided:\n\n` +
        clashes.map((c) => `  - ${c}`).join('\n\n') +
        `\n\nOrders step by 10 inside a group so a page can be slipped between two\n` +
        `others without renumbering the rest. Pick an unused number.`,
      )
    }
    expect(clashes).toEqual([])
  })

  it('has a label for every group it puts something in', () => {
    const th = JSON.parse(readFileSync(TH, 'utf8')) as Record<string, string>
    const en = JSON.parse(readFileSync(EN, 'utf8')) as Record<string, string>
    const missing: string[] = []
    for (const groupKey of new Set(all().map((e) => e.groupKey))) {
      if (!th[groupKey]) missing.push(`${groupKey} (th)`)
      if (!en[groupKey]) missing.push(`${groupKey} (en)`)
    }
    if (missing.length) {
      throw new Error(
        `These groups hold pages but have no label, so the sidebar renders the raw\n` +
        `key as a heading:\n${missing.map((m) => `  - ${m}`).join('\n')}\n\n` +
        `Add them to src/modules/orva/i18n/{th,en}.json.`,
      )
    }
    expect(missing).toEqual([])
  })

  it('keeps every group short enough to scan', () => {
    const counts = new Map<string, number>()
    const seenRoutes = new Set<string>()
    for (const entry of all()) {
      if (seenRoutes.has(entry.route)) continue
      seenRoutes.add(entry.route)
      // Sub-pages (…/create, …/pipeline) render as children of their parent
      // rather than as their own row, so they do not add to the visible count.
      if (/\/(create|pipeline|map|compose)$/.test(entry.route)) continue
      counts.set(entry.groupKey, (counts.get(entry.groupKey) ?? 0) + 1)
    }
    const walls = [...counts].filter(([, n]) => n > MAX_ITEMS_PER_GROUP)
    if (walls.length) {
      throw new Error(
        `These groups have more than ${MAX_ITEMS_PER_GROUP} top-level items, which is where a\n` +
        `sidebar group stops being a list and becomes a wall:\n` +
        walls.map(([g, n]) => `  - ${g}: ${n}`).join('\n') +
        `\n\nSplit it the way Accounting was split from Reports & Tax: by what the\n` +
        `operator is there to DO, not by which module owns the page.`,
      )
    }
    expect(walls).toEqual([])
  })
})
