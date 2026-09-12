import { describe, expect, it } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NAV_GROUP_ICON_IDS } from '../navGroupIcons'

/**
 * Every sidebar group carries a mark.
 *
 * The shell puts an icon on the group heading and nothing on the items under
 * it. A group with no entry in `navGroupIcons` renders its label alone —
 * deliberately, since a shared fallback glyph repeated across groups is the
 * noise this design removed. That makes the failure quiet: add a tenth group
 * to `src/modules.ts` and its heading simply sits a little further left than
 * the other nine, which nobody notices in a diff.
 *
 * So the two lists are held together here. Adding a group means choosing an
 * icon for it in the same change.
 */

const MODULES_TS = join(__dirname, '..', '..', '..', 'modules.ts')

/** The `pageGroupKey` of every group declared in the NAV map. */
function navGroupIds(): string[] {
  const source = readFileSync(MODULES_TS, 'utf8')
  const block = source.slice(source.indexOf('const NAV = {'), source.indexOf('} as const'))
  return [...block.matchAll(/pageGroupKey:\s*'([^']+)'/g)].map((m) => m[1])
}

describe('the sidebar group marks', () => {
  it('finds the groups it is supposed to be covering', () => {
    // A renamed NAV map would otherwise make the rule below vacuous.
    expect(navGroupIds().length).toBeGreaterThan(5)
    expect(NAV_GROUP_ICON_IDS.length).toBeGreaterThan(5)
  })

  it('gives every group one', () => {
    const missing = navGroupIds().filter((id) => !NAV_GROUP_ICON_IDS.includes(id))
    if (missing.length) {
      throw new Error(
        `These sidebar groups have no icon, so their heading renders as bare text\n` +
        `while every other group is marked:\n${missing.map((m) => `  - ${m}`).join('\n')}\n\n` +
        `Add them to ICONS in src/components/shell/navGroupIcons.tsx.`,
      )
    }
    expect(missing).toEqual([])
  })

  it('marks no group that no longer exists', () => {
    const stray = NAV_GROUP_ICON_IDS.filter((id) => !navGroupIds().includes(id))
    if (stray.length) {
      throw new Error(`Icons kept for groups that are gone:\n${stray.map((s) => `  - ${s}`).join('\n')}`)
    }
    expect(stray).toEqual([])
  })
})
