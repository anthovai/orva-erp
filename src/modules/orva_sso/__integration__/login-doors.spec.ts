import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'

/**
 * The SSO doors, and that every one of them stays shut.
 *
 * `orva_sso` is a login path: it mints a staff session from an identity
 * provider's assertion. The pure helpers — PKCE, domain matching, redirect
 * sanitising, constant-time compare — have unit tests. The routes, which are
 * the actual doors, had none.
 *
 * There is no identity provider in an ephemeral environment and this spec
 * does not pretend otherwise. It does not need one: every failure path in the
 * callback is reached BEFORE the token exchange, and the start route fails
 * before it sets anything. So what is proved here is the half that matters
 * most for auth code — that the ways in which are not a real flow all end at
 * `/login?error=…` **with no session issued**. The happy path needs a real
 * IdP and stays out of scope rather than being faked, because a faked
 * verification would prove that the fake works.
 *
 * Two leaks are also pinned, both one careless edit away:
 *
 *   - `/api/orva_sso/discover` is called by the login form before anyone has
 *     signed in. It answers a boolean on purpose. Returning the matching
 *     connection instead would hand an anonymous caller the tenant's issuer
 *     URL and client id.
 *   - `client_secret` is deliberately absent from every projection of the
 *     connections API. It is stored encrypted; a projection that included it
 *     would decrypt it straight into the browser.
 */

const CREDENTIALS = { email: 'admin@acme.com', password: 'secret' }
type Json = Record<string, unknown>

async function login(playwright: PlaywrightWorkerArgs['playwright'], baseURL: string | undefined): Promise<APIRequestContext> {
  const anonymous = await playwright.request.newContext({ baseURL })
  const response = await anonymous.post('/api/auth/login', { form: CREDENTIALS })
  expect(response.status(), await response.text()).toBe(200)
  const cookie = response.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value.split(';')[0]).join('; ')
  expect(cookie, `login returned no cookie: ${await response.text()}`).not.toBe('')
  await anonymous.dispose()
  return playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie } })
}

async function readJson(response: { text: () => Promise<string>; status: () => number }): Promise<Json> {
  const body = await response.text()
  try { return JSON.parse(body) as Json } catch {
    throw new Error(`expected JSON, got ${response.status()}: ${body.slice(0, 300) || '(empty body)'}`)
  }
}

const setCookies = (response: { headersArray: () => Array<{ name: string; value: string }> }): string[] =>
  response.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value)

/** Where a 3xx points, and what it tried to plant on the way. */
function redirect(response: { status: () => number; headers: () => Record<string, string>; headersArray: () => Array<{ name: string; value: string }> }) {
  const cookies = setCookies(response)
  return {
    status: response.status(),
    location: response.headers()['location'] ?? '',
    cookies,
    // The only assertion that really matters on a refused login.
    session: cookies.find((c) => c.startsWith('auth_token=') && !c.startsWith('auth_token=;')),
    state: cookies.find((c) => c.startsWith('orva_sso_state=') && !c.startsWith('orva_sso_state=;')),
  }
}

test.describe('every way into the app that is not a real SSO flow ends at the login page', () => {
  let request: APIRequestContext
  let anonymous: APIRequestContext
  /** Unique per run so the login form's SSO hint never appears for another spec. */
  const domain = `sso-${Date.now().toString(36)}.example`
  const secret = `sh-${Date.now().toString(36)}-never-leaves-the-server`
  let connectionId = ''

  test.beforeAll(async ({ playwright, baseURL }) => {
    request = await login(playwright, baseURL)
    anonymous = await playwright.request.newContext({ baseURL })

    const created = await request.post('/api/orva_sso/connections', {
      data: {
        name: `IdP ทดสอบ ${domain}`,
        // `.example` is reserved by RFC 2606 and resolves nowhere, so
        // discovery fails the way an IdP outage does — which is a path worth
        // walking, not an obstacle.
        issuerUrl: `https://idp.${domain}/`,
        clientId: 'orva-integration',
        clientSecret: secret,
        emailDomains: domain,
        enabled: true,
      },
    })
    expect(created.status(), await created.text()).toBeLessThan(300)
    connectionId = String((await readJson(created)).id ?? '')
    expect(connectionId).toMatch(/^[0-9a-f-]{36}$/i)
  })

  test.afterAll(async () => {
    if (connectionId) await request.delete('/api/orva_sso/connections', { data: { id: connectionId } })
    await request.dispose()
    await anonymous.dispose()
  })

  test('the callback issues no session without a state cookie, a valid one, or a code', async () => {
    test.setTimeout(120_000)

    const noCookie = redirect(await anonymous.get('/api/orva_sso/callback?code=abc&state=xyz', { maxRedirects: 0 }))
    expect(noCookie.location).toContain('/login?error=sso_state_mismatch')
    expect(noCookie.session, 'a callback with no state cookie must not sign anybody in').toBeUndefined()

    // A cookie that is not a signature this server made. The shape is right
    // and the contents are a lie — which is the whole point of signing it.
    const forged = await anonymous.get('/api/orva_sso/callback?code=abc&state=xyz', {
      maxRedirects: 0,
      headers: { cookie: 'orva_sso_state=eyJhbGciOiJub25lIn0.eyJzdGF0ZSI6Inh5eiJ9.' },
    })
    const forgedResult = redirect(forged)
    expect(forgedResult.location).toContain('/login?error=sso_state_mismatch')
    expect(forgedResult.session, 'an unsigned state cookie must not sign anybody in').toBeUndefined()

    // Missing the code entirely: refused before anything is looked up.
    const noCode = redirect(await anonymous.get('/api/orva_sso/callback?state=xyz', { maxRedirects: 0 }))
    expect(noCode.location).toContain('/login?error=sso_invalid_callback')
    expect(noCode.session).toBeUndefined()
  })

  test('the start route fails closed, and plants nothing when it does', async () => {
    test.setTimeout(120_000)

    // Nobody claims this domain: back to the password form, no state carried.
    const unknown = redirect(await anonymous.get(
      `/api/orva_sso/start?email=${encodeURIComponent(`nobody@unclaimed-${Date.now().toString(36)}.example`)}`,
      { maxRedirects: 0 },
    ))
    expect(unknown.location).toContain('/login?error=sso_not_configured')
    expect(unknown.state, 'a refused start must not leave a state cookie behind').toBeUndefined()
    expect(unknown.session).toBeUndefined()

    // The domain IS claimed, but the IdP cannot be reached. The flow must
    // stop at the login page rather than continue without a verified
    // assertion — an IdP outage is not a reason to let somebody in.
    const unreachable = redirect(await anonymous.get(
      `/api/orva_sso/start?email=${encodeURIComponent(`someone@${domain}`)}`,
      { maxRedirects: 0 },
    ))
    expect(unreachable.location).toContain('/login?error=sso_idp_unreachable')
    expect(unreachable.state, 'no state is stored when the flow never started').toBeUndefined()
    expect(unreachable.session, 'an unreachable IdP must never mean a session').toBeUndefined()

    // A malformed email is a bad request, not a redirect into anything.
    expect((await anonymous.get('/api/orva_sso/start?email=not-an-email', { maxRedirects: 0 })).status()).toBe(400)
  })

  test('discovery tells an anonymous caller yes or no, and nothing else', async () => {
    test.setTimeout(120_000)

    const hit = await anonymous.get(`/api/orva_sso/discover?email=${encodeURIComponent(`someone@${domain}`)}`)
    expect(hit.status(), await hit.text()).toBe(200)
    const hitBody = await hit.text()
    expect(JSON.parse(hitBody)).toEqual({ sso: true })

    const miss = await anonymous.get(`/api/orva_sso/discover?email=nobody@unclaimed-${Date.now().toString(36)}.example`)
    expect(JSON.parse(await miss.text())).toEqual({ sso: false })

    // Stated as a substring check too, because `toEqual` would still pass if
    // a future shape nested the connection under another key.
    for (const leak of [`idp.${domain}`, 'orva-integration', secret, connectionId]) {
      expect(hitBody, `discovery leaked ${leak} to an anonymous caller`).not.toContain(leak)
    }
  })

  test('the client secret never comes back out, and the admin API is not open', async () => {
    test.setTimeout(120_000)

    expect((await anonymous.get('/api/orva_sso/connections')).status(), 'connections is not a public list').toBe(401)

    // Read it back every way the API offers, as raw text — a field added to a
    // projection would show up here even if nothing else asserted on it.
    const list = await request.get('/api/orva_sso/connections?pageSize=100')
    expect(list.status(), await list.text()).toBe(200)
    const listText = await list.text()
    expect(listText, 'the connection under test is in the list').toContain(connectionId)
    expect(listText, 'the client secret must never reach a browser').not.toContain(secret)

    const detail = await request.get(`/api/orva_sso/connections?id=${connectionId}`)
    expect(detail.status(), await detail.text()).toBe(200)
    expect(await detail.text(), 'not through the detail projection either').not.toContain(secret)

    // Updating without a secret keeps the stored one; the response still
    // carries nothing. (Blank means "leave it alone" by contract.)
    const updated = await request.put('/api/orva_sso/connections', {
      data: { id: connectionId, name: `IdP ทดสอบ ${domain} (แก้ชื่อ)` },
    })
    expect(updated.status(), await updated.text()).toBeLessThan(300)
    expect(await updated.text()).not.toContain(secret)
  })
})
