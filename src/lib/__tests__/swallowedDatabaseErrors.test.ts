import { describe, expect, it } from '@jest/globals'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * A failed database read must leave a trace. It may not quietly become an
 * answer.
 *
 * This is the most expensive pattern in this codebase's short history. In two
 * days it produced five wrong answers, every one of which looked like
 * ordinary, correct output:
 *
 *   1. `em.execute(...).catch(() => [])` on the support portal's attachment
 *      list. The SQL compared a `text` column to a `uuid` — Postgres has no
 *      such operator, so it ERRORED, and the catch turned "I could not ask"
 *      into "this ticket has no files".
 *   2. The readiness panel read `orva_gl_periods`, a table that has never
 *      existed under that name. Its catch returned the fallback count of
 *      zero, and the panel told the owner "no open accounting period — cannot
 *      post" for a tenant with two open periods.
 *   3. The same helper read `customer_accounts_users`, which is
 *      `customer_users`, and reported no portal accounts where there were
 *      three.
 *   4. The same helper joined `orva_gl_journals.source_ref`, a column that
 *      does not exist, and reported "all invoices posted" having counted
 *      nothing — a false OK, which is worse than a false alarm.
 *   5. Because those checks shared one transaction, the first failure aborted
 *      it, so the RLS check never ran and returned its fallback: an invented
 *      red blocker about the property the whole design rests on.
 *
 * None of these produced a stack trace, a failed request, or a log line. That
 * is the point: a swallowed read is indistinguishable from an empty result,
 * and empty results are normal. The bug hides inside correct-looking output
 * until somebody happens to notice the number is wrong.
 *
 * The rule is NOT "never catch" — carrying on is often right. The rule is that
 * the catch must still be holding the reason: see RETHROWS below for where the
 * line falls and why it is drawn there rather than at "must log" or "must not
 * return a literal", both of which would condemn most of this codebase's
 * perfectly correct route handlers.
 *
 * The shape to copy is the corrected readiness route: each query runs in its
 * own SAVEPOINT, a failure is pushed onto `missing[]`, and the route returns
 * that list as `unread` — so a question that could not be asked appears as a
 * question that could not be asked.
 *
 * See `.ai/lessons/installed-table-joins-match-the-declared-column-type.md`.
 */

const ROOT = join(__dirname, '..', '..', '..')
const LIB_DIR = join(__dirname, '..')
const MODULES_DIR = join(__dirname, '..', '..', 'modules')

/** Reading the database — the ORM's spellings and raw SQL alike. */
const DB_CALL = /\b(?:execute|find|findOne|findAll|findAndCount|qb|createQueryBuilder|count)\s*\(/

/**
 * What separates a handled failure from a swallowed one, stated as narrowly
 * as it can be: **the catch looks at the error**.
 *
 * That one line divides every case cleanly. The route handlers across this
 * codebase read `error.message`, pick a status from it and return it — the
 * reason survives, so they are fine, and a rule phrased as "must log" or
 * "must not return a literal" would have condemned all of them. The five
 * incidents above did the opposite: not one so much as bound the error.
 * `catch { return fallback }` cannot tell anybody anything, because by then
 * it no longer holds the thing that went wrong.
 *
 * A bare `throw` counts too: rethrowing untouched passes the reason upward
 * intact, which is the whole point.
 */
const RETHROWS = /\bthrow\b/

/**
 * Transaction teardown. `rollback to savepoint`'s own catch is the one place
 * a bare swallow is right: it runs on the error path, and letting it throw
 * would replace the real failure with a secondary one. The exemption is
 * written as the shape rather than as a file path so it cannot rot.
 */
const TEARDOWN = /\b(?:rollback|release\s+savepoint|commit)\b/i

/** `.catch(() => <neutral>)` — an answer substituted for a failure. */
const INLINE_SWALLOW = /\.catch\s*\(\s*\(\s*\)\s*=>\s*(?:\[\s*\]|null|undefined|\{\s*\}|\(\s*\{\s*\}\s*\)|0|false|''|""|``)\s*\)/g

/**
 * Places a reviewer has looked at and accepted, with the reason. Empty is the
 * healthy state: every entry is somewhere the code cannot tell a broken query
 * from an empty table, so each should be a decision, not a habit.
 */
const ACCEPTED: Array<{ file: string; line: number; reason: string }> = []

function sourceFiles(): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '__tests__' || name === '__integration__') continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.tsx?$/.test(name) && !/\.(test|spec)\./.test(name)) found.push(path)
    }
  }
  walk(LIB_DIR)
  // Only the modules this project owns. `src/modules/example` ships with the
  // framework as a sample; its choices are not ours to police.
  for (const name of readdirSync(MODULES_DIR)) {
    if (name.startsWith('orva')) walk(join(MODULES_DIR, name))
  }
  return found
}

const rel = (file: string) => relative(ROOT, file).split(sep).join('/')
const lineOf = (source: string, index: number) => source.slice(0, index).split('\n').length

/** The `{…}` starting at `open`, brace-counted past strings and comments. */
function blockAt(source: string, open: number): string {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (ch === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); if (i < 0) break; continue }
    if (ch === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i + 2) + 1; if (i < 1) break; continue }
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < source.length && source[i] !== ch; i++) if (source[i] === '\\') i++
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return source.slice(open, i + 1)
  }
  return source.slice(open)
}

/** The `try { … }` block whose closing brace sits just before `catch`. */
function tryBlockBefore(source: string, catchAt: number): string {
  const close = source.lastIndexOf('}', catchAt)
  if (close < 0) return ''
  let depth = 0
  for (let i = close; i >= 0; i--) {
    if (source[i] === '}') depth++
    else if (source[i] === '{' && --depth === 0) return source.slice(i, close + 1)
  }
  return ''
}

/**
 * The name of the call that `.catch` at `at` is attached to: for
 * `em.execute(sql).catch(…)` that is `execute`, and for `res.json().catch(…)`
 * it is `json`. Returns '' when the catch hangs off something that is not a
 * call at all.
 */
function calleeBefore(source: string, at: number): string {
  let i = at - 1
  while (i >= 0 && /\s/.test(source[i])) i--
  if (source[i] !== ')') return ''
  let depth = 0
  for (; i >= 0; i--) {
    if (source[i] === ')') depth++
    else if (source[i] === '(' && --depth === 0) break
  }
  return (/([A-Za-z_$][\w$]*)\s*$/.exec(source.slice(0, i)) ?? ['', ''])[1]
}

type Offence = { where: string; snippet: string }
const CATCH = /\bcatch\s*(?:\(([^)]*)\)\s*)?\{/g

/** The whole rule, over one file's text — kept separate so it can be tested. */
function scan(name: string, source: string): { blocks: Offence[]; inline: Offence[] } {
  const blocks: Offence[] = []
  const inline: Offence[] = []
  const isAccepted = (line: number) => ACCEPTED.some((e) => e.file === name && e.line === line)

  for (const match of source.matchAll(CATCH)) {
    const at = match.index ?? 0
    // Only catches that wrap a database read: a try/catch around a URL
    // parse or an optional DI probe is a different decision entirely, and
    // not this rule's business.
    if (!DB_CALL.test(tryBlockBefore(source, at))) continue
    const body = blockAt(source, at + match[0].length - 1)
    if (RETHROWS.test(body)) continue
    // `catch (error)` that goes on to mention `error` has kept hold of the
    // reason; `catch {}` never had it to begin with.
    const binding = (match[1] ?? '').trim().replace(/:.*$/, '').trim()
    if (binding && new RegExp(`\\b${binding}\\b`).test(body)) continue
    const line = lineOf(source, at)
    if (isAccepted(line)) continue
    blocks.push({ where: `${name}:${line}`, snippet: body.replace(/\s+/g, ' ').slice(0, 90) })
  }

  for (const match of source.matchAll(INLINE_SWALLOW)) {
    const at = match.index ?? 0
    // What the catch is CHAINED TO, not what happens to sit near it. A window
    // of surrounding text flagged `res.json().catch(() => null)` whenever a
    // query appeared a few lines above — a false alarm on the commonest
    // correct catch in the codebase, which is how a guard gets switched off.
    const callee = calleeBefore(source, at)
    if (!DB_CALL.test(`${callee}(`)) continue
    if (TEARDOWN.test(source.slice(Math.max(0, at - 120), at))) continue
    const line = lineOf(source, at)
    if (isAccepted(line)) continue
    inline.push({ where: `${name}:${line}`, snippet: match[0].replace(/\s+/g, ' ') })
  }
  return { blocks, inline }
}

function findOffences(): { blocks: Offence[]; inline: Offence[] } {
  const blocks: Offence[] = []
  const inline: Offence[] = []
  for (const file of sourceFiles()) {
    const found = scan(rel(file), readFileSync(file, 'utf8'))
    blocks.push(...found.blocks)
    inline.push(...found.inline)
  }
  return { blocks, inline }
}

const report = (title: string, offences: Offence[]) =>
  `${title}\n${offences.map((o) => `  - ${o.where}   ${o.snippet}`).join('\n')}\n\n` +
  'A read that could not run must say so. Rethrow it, log it, put it on screen,\n' +
  'or collect it the way the readiness route collects `missing[]` and returns it\n' +
  'as `unread`. What it must not do is answer — an empty result is exactly what a\n' +
  'working query looks like, so a silent failure is invisible by construction.\n' +
  'If this one is genuinely right, add {file, line, reason} to ACCEPTED in this file.'

/**
 * The rule, tried against the code that actually caused the incidents and
 * against the code that must keep passing.
 *
 * A guard that only ever runs over a clean tree proves nothing: it stays green
 * whether it works or not. These fixtures are the real shapes, reduced — the
 * left column is what got written, the right column is the verdict it must
 * get. If somebody loosens a pattern above, this is what goes red.
 */
const CAUGHT: Array<[string, string]> = [
  ['the attachment list (incident 1)', `
    const rows = await em.execute(\`select id from attachments where record_id = t.id\`).catch(() => [])`],
  ['a fallback count (incidents 2-4)', `
    async function openPeriods() {
      try {
        const rows = await em.execute('select count(*) from orva_gl_periods', [])
        return rows[0]
      } catch {
        return { count: 0 }
      }
    }`],
  ['a catch that names the error but never reads it', `
    try { await em.find(Ticket, { id }) } catch (error) { return null }`],
  ['a bare swallow on a query builder', `
    const total = await em.createQueryBuilder(Invoice).count().catch(() => 0)`],
]

const ALLOWED: Array<[string, string]> = [
  ['a route handler that returns the reason', `
    try { await em.find(Invoice, {}) } catch (error) {
      const status = (error as { status?: number }).status ?? 500
      return Response.json({ error: error instanceof Error ? error.message : 'failed' }, { status })
    }`],
  ['collecting the failure the way readiness does', `
    try { const rows = await em.execute(sql, params); return rows[0] } catch (error) {
      missing.push(\`\${label}: \${String(error)}\`)
      return fallback
    }`],
  ['a rethrow', `
    try { await em.execute(sql) } catch { throw new Error('could not read') }`],
  ['the savepoint rollback on the error path', `
    const rows = await tem.execute(sql, params)
    await tem.execute(\`rollback to savepoint \${name}\`).catch(() => {})`],
  ['a response body that is not JSON', `
    const rows = await em.find(Quote, {})
    const body = await res.json().catch(() => null)`],
  ['an optional DI probe', `
    try { return container.resolve<FinanceBridge>('orvaFinanceBridge') } catch { return null }`],
]

describe('the rule itself', () => {
  it.each(CAUGHT)('flags %s', (_label, code) => {
    const { blocks, inline } = scan('fixture.ts', code)
    expect(blocks.length + inline.length).toBeGreaterThan(0)
  })

  it.each(ALLOWED)('leaves %s alone', (_label, code) => {
    const { blocks, inline } = scan('fixture.ts', code)
    expect([...blocks, ...inline].map((o) => o.snippet)).toEqual([])
  })
})

describe('a failed database read never passes for an answer', () => {
  it('scans the app modules and lib at all', () => {
    // A move or a rename that emptied this list would make every rule below
    // pass by having nothing to check.
    const files = sourceFiles()
    expect(files.length).toBeGreaterThan(100)
    expect(files.some((f) => rel(f).startsWith('src/lib/'))).toBe(true)
    expect(files.some((f) => rel(f).includes('/orva_finance/'))).toBe(true)
  })

  it('finds the database reads it is supposed to be guarding', () => {
    // And that DB_CALL still matches how this codebase spells a query.
    const reading = sourceFiles().filter((f) => DB_CALL.test(readFileSync(f, 'utf8')))
    expect(reading.length).toBeGreaterThan(20)
  })

  it('leaves no catch around a database read that never looks at the error', () => {
    const { blocks } = findOffences()
    if (blocks.length) throw new Error(report('These catch blocks throw the database failure away without reading it:', blocks))
    expect(blocks).toEqual([])
  })

  it('chains no `.catch(() => neutral)` onto a database read', () => {
    const { inline } = findOffences()
    if (inline.length) throw new Error(report('These database reads substitute a made-up answer for a failure:', inline))
    expect(inline).toEqual([])
  })
})
