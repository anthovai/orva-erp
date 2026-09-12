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
    ['/backend/tasking', 10],            // งาน
    ['/backend/work-upcoming', 20],      // กำลังจะถึง
    ['/backend/work-projects', 30],      // โปรเจกต์
    ['/backend/work-labels', 40],        // ป้ายกำกับ
    ['/backend/projects', 50],          // การเรียกเก็บตามโปรเจกต์
  ])('keeps %s, which declares the group itself, at %i', (route, order) => {
    expect(own.get(route)).toBe(order)
  })

  it.each([
    ['/backend/calendar', 60],                   // ปฏิทิน
    ['/backend/customer-tasks', 70],             // งานที่เกี่ยวข้องกับลูกค้า
    ['/backend/tasks', 80],                      // งานผู้ใช้
    ['/backend/staff/timesheets', 90],           // บันทึกเวลาของฉัน
    ['/backend/staff/timesheets/projects', 100],  // โครงการ
    // navHidden upstream, so it never shows in the sidebar; grouped only so
    // its breadcrumb sits under the same heading as the page it creates for.
    ['/backend/staff/timesheets/projects/create', 101],
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

  /**
   * โครงการ is nested under บันทึกเวลาของฉัน, on purpose.
   *
   * `buildAdminNav` makes a route a child when another route's href is a
   * prefix of it *and* the two share a groupId; `CollapsibleNavSection` then
   * draws children only while the parent is the active route. So putting
   * `/backend/staff/timesheets` and `/backend/staff/timesheets/projects` in
   * one group means the second is invisible until the first is opened. The
   * owner was shown the alternatives on 2026-09-07 and chose to keep both
   * here anyway.
   *
   * This test exists so the arrangement cannot change by accident. If it
   * fails, someone has split the two apart or renamed a path — which is a
   * decision to make on purpose, by editing this test, not a regression to
   * paper over.
   */
  it('keeps โครงการ nested under บันทึกเวลาของฉัน, which is a decision and not an accident', () => {
    const parent = '/backend/staff/timesheets'
    const child = '/backend/staff/timesheets/projects'

    // The two conditions buildAdminNav actually tests for.
    expect(child.startsWith(`${parent}/`)).toBe(true)
    expect(moved.has(parent)).toBe(true)
    expect(moved.has(child)).toBe(true)

    // Same group is what turns a path prefix into a parent.
    expect(moved.get(parent)!.order).toBeLessThan(moved.get(child)!.order)
  })

  /**
   * Nothing else in the group may nest by accident.
   *
   * Every other pair of paths in this group must be unrelated, so a page the
   * owner expects to see flat does not quietly become a child of its
   * neighbour the way โครงการ did.
   */
  it('nests nothing beyond the four already known to nest', () => {
    const paths = [...own.keys(), ...moved.keys()]
    /*
      One of the nine entries is a child rather than a sibling, and so is
      drawn only while its parent is the active route:

        /backend/staff/timesheets/projects → under บันทึกเวลาของฉัน

      It is an installed path and cannot be moved. The three tasking pages
      used to be here too, at /backend/tasking/{upcoming,projects,labels};
      they are app-owned, so they were flattened to /backend/work-* on
      2026-09-07 and now render as siblings.

      Anything NOT on this list nesting is a straight regression: it means a
      page the owner expects to see in the sidebar disappears whenever they
      are looking at something else.
    */
    const allowed = new Set([
      '/backend/staff/timesheets/projects',
      '/backend/staff/timesheets/projects/create',
    ])
    const accidental: string[] = []
    for (const path of paths) {
      if (allowed.has(path)) continue
      const nestsUnder = paths.find((other) => other !== path && path.startsWith(`${other}/`))
      if (nestsUnder) accidental.push(`${path} would render under ${nestsUnder}`)
    }
    expect(accidental).toEqual([])
  })

  it('holds nothing beyond the pages named above', () => {
    // A page appearing here without a line in this test is a page nobody
    // decided to put in front of the owner.
    expect([...own.keys()].sort()).toEqual([
      '/backend/projects',
      '/backend/tasking',
      '/backend/work-labels',
      '/backend/work-projects',
      '/backend/work-upcoming',
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
