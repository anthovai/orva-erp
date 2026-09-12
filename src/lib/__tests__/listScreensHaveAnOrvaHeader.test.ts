import { describe, expect, it } from '@jest/globals'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A list screen is a screen, not a rendered component.
 *
 * Every list in this app used to be the installed `DataTable` and nothing
 * else. It took `title="Vendors"`, drew that small above a bordered card, and
 * the page was the grid — which is why these screens read as the framework
 * with a green accent rather than as Orva. A string title answers one question
 * (what is this) and leaves the two an operator actually arrives with: which
 * department am I in, and what is the state of this whole set.
 *
 * `OrvaPageHeader` answers all three, and carries the mint node that
 * `docs/BRAND.md` reserves for "a module, something the system is doing".
 * Before this it appeared only in empty states — the product's own voice was
 * visible exactly when it had nothing to say.
 *
 * So: a DataTable that shows a title must get that header rather than a bare
 * string. The rule is narrow on purpose — it says nothing about what the
 * header contains, only that the screen has one.
 */

const MODULES_DIR = join(__dirname, '..', '..', 'modules')

type Screen = { file: string; usesHeader: boolean; bareTitle: string | null }

function screens(): Screen[] {
  const found: Screen[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === '__tests__' || name === '__integration__' || name === 'node_modules') continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) { walk(path); continue }
      if (!name.endsWith('.tsx')) continue
      const source = readFileSync(path, 'utf8')
      if (!source.includes('<DataTable')) continue
      // A title given as a plain string or a bare `t(...)` call — i.e. text
      // where a header should be.
      const bare = /title=\{\s*t\('[^']+',\s*'[^']*'\)\s*\}|title="[^"]*"/.exec(source)
      found.push({
        file: path.slice(path.indexOf('src')).split('\\').join('/'),
        usesHeader: source.includes('OrvaPageHeader'),
        bareTitle: bare ? bare[0].slice(0, 60) : null,
      })
    }
  }
  for (const name of readdirSync(MODULES_DIR)) {
    if (name.startsWith('orva')) walk(join(MODULES_DIR, name))
  }
  return found
}

describe('list screens', () => {
  it('finds the screens it is checking', () => {
    const all = screens()
    expect(all.length).toBeGreaterThan(8)
    expect(all.some((s) => s.usesHeader)).toBe(true)
  })

  it('give a titled table an Orva header rather than a bare string', () => {
    const bare = screens().filter((s) => s.bareTitle && !s.usesHeader)
    if (bare.length) {
      throw new Error(
        'These list screens hand DataTable a plain title, which renders as the\n' +
        'framework default — small text above a card, saying only what the records\n' +
        'are called:\n' +
        bare.map((s) => `  - ${s.file}\n      ${s.bareTitle}`).join('\n') +
        '\n\nWrap it in <OrvaPageHeader embedded kicker={…} title={…} fact={…} /> and\n' +
        'pass that as `title`. The title slot is reserved by DataTable either way,\n' +
        'so putting the header anywhere else leaves an empty band above the table.',
      )
    }
    expect(bare).toEqual([])
  })
})
