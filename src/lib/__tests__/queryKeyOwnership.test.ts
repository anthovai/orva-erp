import { describe, expect, it } from '@jest/globals'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * A React Query key is a contract about SHAPE, not just about the endpoint.
 *
 * Two `useQuery` sites on the same key whose queryFns return different shapes
 * (the `{ items }` envelope from `fetchCrudList` vs the unwrapped array) or use
 * different filters mean whichever screen renders first decides what the other
 * reads — and only on client-side navigation, because that is the only time
 * the cache survives between screens. A URL reload never reproduces it. This
 * crashed the owner twice: `orva_tasking.projects` on 2026-09-07 and
 * `orva_finance.accounts.all` on 2026-09-09 ("allAccounts.filter is not a
 * function" on the expenses screen after visiting vendor bills).
 *
 * The rule this test enforces: every key's first segment is DEFINED in exactly
 * one file. Screens that want the same data import that file's hook; a screen
 * that wants a different shape or filter uses a different key. Invalidations
 * are not definitions and may name any key from anywhere.
 */

const MODULES_DIR = join(__dirname, '..', '..', 'modules')

type Definition = { file: string; line: number; key: string; first: string }

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === '__integration__' || name === 'node_modules') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name)) out.push(path)
  }
}

function definitions(): Definition[] {
  const files: string[] = []
  for (const name of readdirSync(MODULES_DIR)) {
    if (name.startsWith('orva')) walk(join(MODULES_DIR, name), files)
  }
  const defs: Definition[] = []
  const opener = /use(?:Query|Queries|InfiniteQuery)\s*(?:<[^(]*>)?\s*\(\s*\{/g
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    let match: RegExpExecArray | null
    while ((match = opener.exec(src)) !== null) {
      let depth = 0
      let i = src.indexOf('{', match.index)
      for (; i < src.length; i++) {
        if (src[i] === '{') depth++
        else if (src[i] === '}' && --depth === 0) break
      }
      const block = src.slice(match.index, i + 1)
      let key = block.match(/queryKey:\s*(\[[^\]]*\])/)?.[1]
      if (!key) {
        // `queryKey: someName` — resolve the array the file assigns to it, so a
        // key built once and reused is judged by its literal, not exempted.
        const name = block.match(/queryKey:\s*([A-Za-z_$][\w$]*)/)?.[1]
        const assigned = name ? src.match(new RegExp(`(?:const|let)\\s+${name}\\s*(?::[^=]+)?=\\s*(\\[[^\\]]*\\])`))?.[1] : undefined
        key = assigned ?? '(dynamic)'
      }
      const first = key.match(/^\[\s*'([^']+)'/)?.[1] ?? key
      defs.push({
        file: relative(join(MODULES_DIR, '..', '..'), file).split(sep).join('/'),
        line: src.slice(0, match.index).split('\n').length,
        key,
        first,
      })
    }
  }
  return defs
}

describe('React Query keys are owned by exactly one definition site', () => {
  const defs = definitions()

  it('finds the Orva useQuery definitions at all (guards the scanner itself)', () => {
    expect(defs.length).toBeGreaterThan(50)
  })

  it('every key literal starts with a string segment', () => {
    const dynamic = defs.filter((d) => d.first === d.key)
    expect(dynamic.map((d) => `${d.file}:${d.line} ${d.key}`)).toEqual([])
  })

  it('no first segment is defined in more than one file', () => {
    const byFirst = new Map<string, Definition[]>()
    for (const d of defs) byFirst.set(d.first, [...(byFirst.get(d.first) ?? []), d])
    const shared = [...byFirst.entries()]
      .filter(([, sites]) => new Set(sites.map((s) => s.file)).size > 1)
      .map(([first, sites]) => `${first}: ${sites.map((s) => `${s.file}:${s.line}`).join(' | ')}`)
    // Failing here means two screens now share a cache entry. Move the query
    // into one exported hook (see orva_finance/components/queries.ts) and have
    // both screens call it — or give the second screen its own key.
    expect(shared).toEqual([])
  })
})
