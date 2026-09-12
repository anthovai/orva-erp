import { describe, expect, it } from '@jest/globals'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every portal feature a module declares must also be repairable.
 *
 * A customer sees a portal page only if one of their customer roles carries
 * the feature it gates on. Two things have to agree for that to happen:
 *
 *   - `src/modules/<id>/setup.ts` → `defaultCustomerRoleFeatures`, which the
 *     platform merges into the role ACLs when a tenant is created, and
 *   - `scripts/grant-customer-portal-features.mjs`, which grants the same
 *     thing to tenants that already existed when the module was added.
 *
 * Only the first is load-bearing for a NEW tenant, which is exactly why the
 * second drifts unnoticed. On 2026-09-12 it had: `orva_tasking` declared
 * portal grants for portal_admin, buyer and viewer, the live tenant predated
 * the module, nothing re-ran the merge, and so `orva_tasking.portal.view` was
 * granted to nobody. Customers met 403 on the work portal while their
 * invoices loaded normally — the billing portal gates on the customer link
 * alone — so it read as one broken page rather than a missing grant. The
 * upstream merge is also wrapped in a bare `try {} catch {}`, so had it
 * thrown, nothing would have said so.
 *
 * This test is what stops the next module repeating it: declare a portal
 * grant and forget the repair list, and this goes red with the missing lines.
 */

const ROOT = join(__dirname, '..', '..', '..')
const MODULES_DIR = join(ROOT, 'src', 'modules')
const SCRIPT = join(ROOT, 'scripts', 'grant-customer-portal-features.mjs')

type Grants = Record<string, string[]>

/** The `{ role: ['feature', …], … }` object literal that follows `key`. */
function parseGrants(source: string, key: string): Grants {
  const at = source.indexOf(key)
  if (at < 0) return {}
  const open = source.indexOf('{', at)
  let depth = 0
  let close = open
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) { close = i; break }
  }
  const body = source.slice(open + 1, close)

  const grants: Grants = {}
  // role: ['a', 'b'] — comments between entries are skipped by the match.
  for (const entry of body.matchAll(/([A-Za-z_][\w]*)\s*:\s*\[([^\]]*)\]/g)) {
    const features = [...entry[2].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])
    grants[entry[1]] = features
  }
  return grants
}

function declaredByModules(): { grants: Grants; modules: string[] } {
  const grants: Grants = {}
  const modules: string[] = []
  for (const name of readdirSync(MODULES_DIR)) {
    if (!name.startsWith('orva')) continue
    const setup = join(MODULES_DIR, name, 'setup.ts')
    if (!existsSync(setup)) continue
    const found = parseGrants(readFileSync(setup, 'utf8'), 'defaultCustomerRoleFeatures')
    if (!Object.keys(found).length) continue
    modules.push(name)
    for (const [role, features] of Object.entries(found)) {
      grants[role] = [...new Set([...(grants[role] ?? []), ...features])]
    }
  }
  return { grants, modules }
}

const repairable = (): Grants => parseGrants(readFileSync(SCRIPT, 'utf8'), 'PORTAL_FEATURES')

describe('a declared portal grant is also a repairable one', () => {
  it('finds the declarations it is supposed to be comparing', () => {
    // Without this, renaming the key or the script would make the rule below
    // pass by having nothing left to check.
    const { grants, modules } = declaredByModules()
    expect(modules.length).toBeGreaterThan(0)
    expect(Object.keys(grants).length).toBeGreaterThan(0)
    expect(Object.keys(repairable())).not.toEqual([])
  })

  it('grants every feature the modules declare, for every role they name', () => {
    const { grants } = declaredByModules()
    const script = repairable()

    const missing: string[] = []
    for (const [role, features] of Object.entries(grants)) {
      for (const feature of features) {
        if (!(script[role] ?? []).includes(feature)) missing.push(`${role}: ${feature}`)
      }
    }

    if (missing.length) {
      throw new Error(
        `These portal grants are declared in a module's setup.ts but would not be repaired on an\n` +
        `existing tenant, so customers there meet 403 on the page and nothing says why:\n` +
        `${missing.map((m) => `  - ${m}`).join('\n')}\n\n` +
        `Add them to PORTAL_FEATURES in scripts/grant-customer-portal-features.mjs, then run it\n` +
        `(--dry first) against each live tenant.`,
      )
    }
    expect(missing).toEqual([])
  })

  it('repairs nothing a module does not declare', () => {
    // The script writes to live role ACLs. A feature here that no module asks
    // for is a grant nobody decided to make.
    const { grants } = declaredByModules()
    const stray: string[] = []
    for (const [role, features] of Object.entries(repairable())) {
      for (const feature of features) {
        if (!(grants[role] ?? []).includes(feature)) stray.push(`${role}: ${feature}`)
      }
    }
    if (stray.length) {
      throw new Error(
        `The repair script would grant features no module declares:\n${stray.map((s) => `  - ${s}`).join('\n')}`,
      )
    }
    expect(stray).toEqual([])
  })
})
