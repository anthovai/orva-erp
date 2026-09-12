import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'

/**
 * ความพร้อมใช้งาน against a real tenant's tables.
 *
 * The rules are unit-tested; what this proves is the half that unit tests
 * cannot: that the route can actually find each fact. Eight of the nine
 * checks read a different module's table, and a renamed column or a table
 * that does not exist on a given tenant would turn a real problem into a
 * cheerful "ok" — a readiness panel that lies is worse than no panel.
 *
 * So the test changes a setting through the app and insists the panel
 * notices. If the query were broken, the answer would not move.
 *
 * Harness fixtures in an ephemeral database; the session cookie is carried
 * explicitly because the ephemeral app is a production build.
 */

const CREDENTIALS = { email: 'admin@acme.com', password: 'secret' }
type Json = Record<string, unknown>
type Check = { id: string; severity: string; detail: string; href: string | null; labelKey: string }

async function login(playwright: PlaywrightWorkerArgs['playwright'], baseURL: string | undefined): Promise<APIRequestContext> {
  const anonymous = await playwright.request.newContext({ baseURL })
  const response = await anonymous.post('/api/auth/login', { form: CREDENTIALS })
  expect(response.status(), await response.text()).toBe(200)
  const cookie = response.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value.split(';')[0]).join('; ')
  await anonymous.dispose()
  return playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie } })
}

async function readJson(response: { status: () => number; text: () => Promise<string> }): Promise<Json> {
  const body = await response.text()
  try { return JSON.parse(body) as Json } catch {
    throw new Error(`expected JSON, got ${response.status()}: ${body.slice(0, 300) || '(empty body)'}`)
  }
}

async function readiness(request: APIRequestContext): Promise<{ checks: Check[]; summary: Json; unread: string[] }> {
  const res = await request.get('/api/orva/readiness')
  expect(res.status(), await res.text()).toBe(200)
  const body = await readJson(res)
  return { checks: body.checks as Check[], summary: body.summary as Json, unread: (body.unread ?? []) as string[] }
}
const pick = (checks: Check[], id: string): Check => {
  const found = checks.find((c) => c.id === id)
  expect(found, `the panel must report "${id}"`).toBeTruthy()
  return found!
}

test.describe('the readiness panel reads the real tenant', () => {
  let request: APIRequestContext

  test.beforeAll(async ({ playwright, baseURL }) => { request = await login(playwright, baseURL) })
  test.afterAll(async () => { await request.dispose() })

  test('answers every check, and each one points at a screen or says why not', async () => {
    test.setTimeout(120_000)
    const { checks, summary, unread } = await readiness(request)

    // Every check the rules can emit must come back; a query that threw would
    // otherwise just drop its row and the panel would look clean.
    expect(checks.map((c) => c.id).sort()).toEqual(
      ['backup', 'email', 'pdf', 'period', 'portal', 'posting', 'rate', 'rls', 'schedules', 'seller', 'tax'],
    )
    // The harness may connect as a superuser; what matters is that the panel
    // reports what is true rather than assuming. On the real tenant this is
    // `ok`, and a `blocker` here would be a correct report of the harness.
    // Every query behind the panel must actually have run. A wrong table name
    // used to be swallowed and reported as a fact — `orva_gl_periods` never
    // existed, and the panel said "no open accounting period" for a tenant
    // that had two.
    expect(unread, `queries that could not run: ${JSON.stringify(unread)}`).toEqual([])

    const rls = checks.find((c) => c.id === 'rls')!
    expect(['ok', 'blocker']).toContain(rls.severity)
    expect(rls.detail.length).toBeGreaterThan(0)

    for (const check of checks) {
      expect(['blocker', 'warning', 'ok']).toContain(check.severity)
      expect(check.labelKey.startsWith('orva.readiness.'), `${check.id} needs a label key`).toBe(true)
      expect(check.detail.length, `${check.id} must say what is true`).toBeGreaterThan(0)
    }
    expect(Number(summary.blockers) + Number(summary.warnings)).toBeLessThanOrEqual(checks.length)

    // Worst first — the operator reads the top of the list.
    const rank = { blocker: 0, warning: 1, ok: 2 } as Record<string, number>
    const order = checks.map((c) => rank[c.severity])
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  test('notices the hourly rate being set and unset again', async () => {
    test.setTimeout(120_000)
    const settings = await readJson(await request.get('/api/orva_documents/settings'))
    const { updatedAt: _ignored, ...rest } = settings
    void _ignored
    const save = async (rate: number | null) => {
      const res = await request.put('/api/orva_documents/settings', {
        data: { ...rest, sellerName: (rest.sellerName as string) || 'Acme (test)', defaultHourlyRate: rate },
      })
      expect(res.status(), await res.text()).toBe(200)
    }

    await save(null)
    const blank = pick((await readiness(request)).checks, 'rate')
    expect(blank.severity).toBe('warning')
    expect(blank.href).toBe('/backend/settings/documents')

    await save(850)
    const set = pick((await readiness(request)).checks, 'rate')
    expect(set.severity).toBe('ok')
    expect(set.detail).toContain('850')

    // Put it back the way it was, so this spec leaves no trace.
    await save(null)
    expect(pick((await readiness(request)).checks, 'rate').severity).toBe('warning')
  })

  test('reports the default tax rate that lines will actually get', async () => {
    test.setTimeout(120_000)
    const rates = await readJson(await request.get('/api/sales/tax-rates?pageSize=50'))
    const current = ((rates.items ?? []) as Array<Json>).find((r) => r.isDefault)
    const check = pick((await readiness(request)).checks, 'tax')

    if (current && Number(current.rate) === 7) {
      expect(check.severity).toBe('ok')
    } else {
      // The upstream seed ships 23% VAT as the default, which is the whole
      // reason this check exists: it must NOT read as fine.
      expect(check.severity).toBe('blocker')
      expect(check.detail).toContain('7')
    }
    expect(check.href).toBe('/backend/config/sales')
  })

  test('refuses a caller with no session', async ({ playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL })
    expect((await anonymous.get('/api/orva/readiness')).status()).toBe(401)
    await anonymous.dispose()
  })
})
