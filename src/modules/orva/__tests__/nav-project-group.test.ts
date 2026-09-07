import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from '@jest/globals'
import { enabledModules } from '@/modules'

/**
 * The โปรเจกต์และงาน sidebar group, pinned.
 *
 * This group has been wrong four separate times in one sitting: entries hidden
 * that the owner was using, entries restored in an order nobody chose, and one
 * page (`staff/timesheets/projects` — โครงการ) hidden on a claim of mine that
 * turned out to be false. Every time, the only thing that caught it was the
 * owner opening the menu and counting.
 *
 * A page reaches this group by one of two routes, and the group has been
 * broken through both, so both are asserted:
 *
 *  - an app-owned page declares the group in its own `page.meta.ts`;
 *  - an installed page is moved here by an override in `src/modules.ts`.
 *
 * What this cannot see is whether a page then *renders*: an ACL feature gate
 * (`staff.timesheets.projects.view`) or an icon name missing from the ui
 * package's generated registry still needs eyes on the sidebar. What it does
 * catch is a page silently dropping out, or two pages claiming one slot.
 */

const GROUP = 'orva.nav.project'

/** Pages moved into the group by a `src/modules.ts` override. */
type PageOverride = { metadata?: { pageGroupKey?: string; pageOrder?: number; pagePriority?: number } } | null

function overridden(): Map<string, { order: number; priority?: number }> {
  const found = new Map<string, { order: number; priority?: number }>()
  for (const entry of enabledModules) {
    const pages = entry.overrides?.routes?.pages as Record<string, PageOverride> | undefined
    if (!pages) continue
    for (const [route, override] of Object.entries(pages)) {
      const meta = override?.metadata
      if (meta?.pageGroupKey !== GROUP) continue
      found.set(route, { order: meta.pageOrder as number, priority: meta.pagePriority })
    }
  }
  return found
}

/** Pages that declare the group themselves, read from their page.meta.ts. */
function declared(): Map<string, number> {
  const found = new Map<string, number>()
  const modulesRoot = path.join(process.cwd(), 'src', 'modules')
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(abs); continue }
      if (entry.name !== 'page.meta.ts') continue
      const source = fs.readFileSync(abs, 'utf8')
      if (!source.includes(`'${GROUP}'`)) continue
      const order = /pageOrder:\s*(\d+)/.exec(source)
      // src/modules/<id>/backend/<...>/page.meta.ts -> /backend/<...>
      const rel = path.relative(modulesRoot, abs).split(path.sep)
      const route = '/' + rel.slice(1, -1).join('/')
      found.set(route, order ? Number(order[1]) : Number.NaN)
    }
  }
  walk(modulesRoot)
  return found
}

describe('the โปรเจกต์และงาน group', () => {
  const moved = overridden()
  const own = declared()

  it.each([
    ['/backend/tasking', 1],            // งาน
    ['/backend/tasking/upcoming', 2],   // กำลังจะถึง
    ['/backend/tasking/projects', 3],   // โปรเจกต์
    ['/backend/tasking/labels', 4],     // ป้ายกำกับ
    ['/backend/projects', 20],          // การเรียกเก็บตามโปรเจกต์
  ])('keeps %s, which declares the group itself, at %i', (route, order) => {
    expect(own.get(route)).toBe(order)
  })

  it.each([
    ['/backend/calendar', 30],                   // ปฏิทิน
    ['/backend/customer-tasks', 40],             // งานที่เกี่ยวข้องกับลูกค้า
    ['/backend/tasks', 50],                      // งานผู้ใช้
    ['/backend/staff/timesheets', 60],           // บันทึกเวลาของฉัน
    ['/backend/staff/timesheets/projects', 70],  // โครงการ
    // navHidden upstream, so it never shows in the sidebar; grouped only so
    // its breadcrumb sits under the same heading as the page it creates for.
    ['/backend/staff/timesheets/projects/create', 71],
  ])('keeps %s, which is moved here by an override, at %i', (route, order) => {
    const page = moved.get(route)
    expect(page).toBeDefined()
    expect(page!.order).toBe(order)
  })

  /**
   * `pagePriority` outranks `pageOrder` in the sidebar comparator, so a page
   * that ships its own priority ignores a regrouped order and sorts by the
   * number its original module chose for a group it has left. Anything moved
   * here must state both — that is what `place()` exists for.
   */
  it('states a priority wherever an override states an order', () => {
    for (const [, page] of moved) expect(page.priority).toBe(page.order)
  })

  it('gives every page in the group its own slot', () => {
    const orders = [...own.values(), ...[...moved.values()].map((page) => page.order)]
    expect(orders.every((order) => Number.isFinite(order))).toBe(true)
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('holds nothing beyond the pages named above', () => {
    // A page appearing here without a line in this test is a page nobody
    // decided to put in front of the owner.
    expect([...own.keys()].sort()).toEqual([
      '/backend/projects',
      '/backend/tasking',
      '/backend/tasking/labels',
      '/backend/tasking/projects',
      '/backend/tasking/upcoming',
    ])
    expect([...moved.keys()].sort()).toEqual([
      '/backend/calendar',
      '/backend/customer-tasks',
      '/backend/staff/timesheets',
      '/backend/staff/timesheets/projects',
      '/backend/staff/timesheets/projects/create',
      '/backend/tasks',
    ])
  })
})
