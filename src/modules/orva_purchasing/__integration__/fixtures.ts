import { expect, type APIRequestContext, type Browser, type BrowserContext, type PlaywrightWorkerArgs } from '@playwright/test'

/**
 * Shared fixtures for the purchasing integration specs.
 *
 * Credentials are the harness's own documented fixtures in an ephemeral
 * database (see om-prepare-test-env), never a real tenant's.
 */
export const CREDENTIALS = { email: 'admin@acme.com', password: 'secret' }

export type Json = Record<string, unknown>

/**
 * Signs in and returns the session cookie plus a request context carrying it.
 *
 * The ephemeral app is a production build, so `auth_token` and `session_token`
 * are set with `Secure` — and a client will not send a Secure cookie back over
 * plain http, which is what the ephemeral base URL is. The cookie jar
 * therefore silently sends nothing and every authenticated call answers 401.
 * Reading the `set-cookie` values off the login response and putting them on
 * the request context as a header sidesteps the rule the way an API client
 * would, without weakening anything in the app.
 */
export async function login(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string | undefined,
): Promise<{ request: APIRequestContext; cookie: string }> {
  const anonymous = await playwright.request.newContext({ baseURL })
  const response = await anonymous.post('/api/auth/login', { form: CREDENTIALS })
  expect(response.status(), await response.text()).toBe(200)
  const cookie = response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .map((header) => header.value.split(';')[0])
    .join('; ')
  expect(cookie, 'login must set a session cookie').not.toBe('')
  await anonymous.dispose()
  return { request: await playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie } }), cookie }
}

/** Back-compatible helper for the specs that only need the request context. */
export async function authedContext(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string | undefined,
): Promise<APIRequestContext> {
  return (await login(playwright, baseURL)).request
}

/**
 * A signed-in browser context, in Thai.
 *
 * The session cookies are re-added without `Secure` for the same reason the
 * request context sends them as a header. `locale=th` is set deliberately:
 * the tenant is Thai and the operator reads Thai labels, so a walkthrough
 * asserting the English catalogue would be walking a screen nobody uses.
 */
export async function signedInBrowser(
  browser: Browser,
  baseURL: string | undefined,
  cookie: string,
  options: { viewport?: { width: number; height: number }; colorScheme?: 'light' | 'dark' } = {},
): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL, ...options })
  const host = new URL(baseURL ?? 'http://127.0.0.1').hostname
  const pairs = [...cookie.split('; '), 'locale=th']
  await context.addCookies(
    pairs.map((pair) => {
      const index = pair.indexOf('=')
      return { name: pair.slice(0, index), value: pair.slice(index + 1), domain: host, path: '/', secure: false }
    }),
  )
  return context
}

export async function readJson(response: { json: () => Promise<unknown>; text: () => Promise<string> }): Promise<Json> {
  const body = await response.text()
  try {
    return JSON.parse(body) as Json
  } catch {
    throw new Error(`expected JSON, got: ${body.slice(0, 400)}`)
  }
}

/** A party holding the vendor role — purchasing refuses anything else. */
export async function createVendor(request: APIRequestContext, name: string): Promise<string> {
  const created = await request.post('/api/orva_party/parties', {
    data: { kind: 'company', displayName: name, taxId: '0105500000001' },
  })
  expect(created.status(), await created.text()).toBeLessThan(300)
  const party = await readJson(created)
  const partyId = String(party.id ?? (party as { item?: { id?: string } }).item?.id ?? '')
  expect(partyId, 'party create must return an id').not.toBe('')

  const role = await request.post('/api/orva_party/party-roles', {
    data: { partyId, role: 'vendor' },
  })
  expect(role.status(), await role.text()).toBeLessThan(300)
  return partyId
}

/**
 * A GL account for the line to post to.
 *
 * The ephemeral tenant ships no chart of accounts — a real tenant builds one,
 * and `seedExamples` is off for finance — so the fixture creates the one
 * account it needs rather than assuming a seed that does not exist. Reused
 * across the specs: purchasing only stores the id.
 */
export async function ensureAccountId(request: APIRequestContext): Promise<string> {
  const existing = await request.get('/api/orva_finance/gl/accounts?page=1&pageSize=1&isActive=true')
  expect(existing.status(), await existing.text()).toBe(200)
  const items = ((await readJson(existing)).items ?? []) as Array<{ id?: string }>
  if (items.length > 0) return String(items[0].id)

  const created = await request.post('/api/orva_finance/gl/accounts', {
    data: { code: '5900', name: 'ค่าใช้จ่ายอื่น (integration fixture)', accountType: 'expense', isActive: true },
  })
  expect(created.status(), await created.text()).toBeLessThan(300)
  const accountId = String((await readJson(created)).id ?? '')
  expect(accountId, 'account create must return an id').not.toBe('')
  return accountId
}

/**
 * An open fiscal period for the bill to land in. The ephemeral tenant has no
 * chart of accounts and no periods, so the fixture creates what it needs
 * rather than assuming a seed (.ai/lessons.md).
 */
export async function ensurePeriodId(request: APIRequestContext): Promise<string> {
  const existing = await request.get('/api/orva_finance/gl/periods?page=1&pageSize=1&status=open')
  expect(existing.status(), await existing.text()).toBe(200)
  const items = ((await readJson(existing)).items ?? []) as Array<{ id?: string }>
  if (items.length > 0) return String(items[0].id)

  const created = await request.post('/api/orva_finance/gl/periods', {
    // The create contract takes the dates only; a period opens open.
    data: { code: '2026-09', startsOn: '2026-09-01', endsOn: '2026-09-30' },
  })
  expect(created.status(), await created.text()).toBeLessThan(300)
  const periodId = String((await readJson(created)).id ?? '')
  expect(periodId, 'period create must return an id').not.toBe('')
  return periodId
}
