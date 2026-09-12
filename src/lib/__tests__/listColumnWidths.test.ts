import { describe, expect, it } from '@jest/globals'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A column holding somebody's name must be given room to show it.
 *
 * The shared DataTable picks a column's width from its KEY NAME, against a
 * fixed list: `title`, `name`, `description`, `source`, `companies` and
 * `people` get 250px, dates and custom fields get 120, and **everything else
 * falls to 150**. Our keys are `display_name`, `vendorName`, `vendor_party_id`
 * — none of them on that list. So the column carrying a company or a person's
 * name was capped at 150px inside a cell 550px wide, and a Thai company name
 * ran past it almost every time. Measured on the vendor list: the cell was
 * 550px, the inner element 150px, and the text wanted 213px, so the name
 * ellipsised with four hundred pixels of its own cell unused.
 *
 * Nothing about that is visible in the column definition. The key simply is
 * not on a list held in another package, and the failure looks like a long
 * name rather than a layout bug — which is why it survived every one of these
 * screens being reviewed.
 *
 * `meta.maxWidth` is the supported per-column override. This test requires one
 * on any column whose key reads as a name and would otherwise take the
 * default, so a new list screen cannot quietly inherit the same truncation.
 *
 * Document-number columns (`bill_no`, `poNumber`, `code`) are deliberately not
 * covered: 150px fits `PO-202609-0001` with room to spare, and widening them
 * would only push the columns that matter off the screen.
 */

const MODULES_DIR = join(__dirname, '..', '..', 'modules')

/** Keys the installed DataTable already gives more than the default to. */
const ALREADY_WIDE = new Set(['title', 'name', 'description', 'source', 'companies', 'people'])
const ALREADY_MEDIUM = new Set(['status', 'pipelineStage', 'pipeline_stage', 'type', 'category'])

/**
 * Keys that read as somebody's or something's NAME rather than a code.
 *
 * The second half matters as much as the first: `employee_no` contains the
 * word "employee" and is a code — EMP-0001 — so it wants the narrow default,
 * not a name's width. Anything ending in a number/reference suffix is a code
 * however it is spelled.
 */
const NAME_LIKE = /name|memo|title|description|subject|label|party|vendor|customer|employee|company/i
const CODE_LIKE = /(_no|_number|_ref|_code|No|Number|Ref|Code)$/

const takesTheDefault = (key: string): boolean => {
  if (key.startsWith('cf_') || key.startsWith('cf:')) return false
  if (ALREADY_WIDE.has(key) || ALREADY_MEDIUM.has(key)) return false
  if (/_at$|At$/.test(key) || /date/i.test(key)) return false
  return true
}

type Column = { file: string; key: string; hasMaxWidth: boolean }

function columns(): Column[] {
  const found: Column[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === '__tests__' || name === '__integration__' || name === 'node_modules') continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) { walk(path); continue }
      if (!/\.tsx?$/.test(name)) continue
      const source = readFileSync(path, 'utf8')
      if (!source.includes('accessorKey')) continue
      const rel = path.slice(path.indexOf('src')).split('\\').join('/')
      // Each column definition, with whatever meta follows it before the
      // object closes — enough to tell whether it states its own width.
      for (const m of source.matchAll(/accessorKey:\s*'([^']+)'([^}]*)\}/g)) {
        found.push({ file: rel, key: m[1], hasMaxWidth: /maxWidth/.test(m[2]) })
      }
    }
  }
  for (const name of readdirSync(MODULES_DIR)) {
    if (name.startsWith('orva')) walk(join(MODULES_DIR, name))
  }
  return found
}

describe('list columns that hold a name', () => {
  it('finds the column definitions it is checking', () => {
    // A change in how columns are declared would otherwise make this vacuous.
    const all = columns()
    expect(all.length).toBeGreaterThan(40)
    expect(all.some((c) => NAME_LIKE.test(c.key))).toBe(true)
  })

  it('each state a width instead of inheriting the 150px default', () => {
    const cramped = columns().filter(
      (c) => NAME_LIKE.test(c.key) && !CODE_LIKE.test(c.key) && takesTheDefault(c.key) && !c.hasMaxWidth,
    )
    if (cramped.length) {
      const lines = [...new Set(cramped.map((c) => `${c.key} — ${c.file}`))]
      throw new Error(
        'These columns hold a name but take the DataTable\'s 150px default, because their\n' +
        'key is not on the list of wide keys it keeps. A Thai company or person name will\n' +
        'ellipsise inside a cell with room to spare:\n' +
        lines.map((l) => `  - ${l}`).join('\n') +
        "\n\nGive each one meta: { maxWidth: '260px' } (or whatever the content needs).",
      )
    }
    expect(cramped).toEqual([])
  })
})
