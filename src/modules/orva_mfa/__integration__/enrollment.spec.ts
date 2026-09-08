import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'

/**
 * Enrollment through the real route on a production build.
 *
 * The point of this file is the new dependency. `qrcode` renders the QR on the
 * server, which means the production bundle now contains it and the route now
 * does work it did not do before — so the check that matters is not "does the
 * function return a PNG" (a unit test covers that) but "does the built app
 * still answer this route, with the QR in it".
 *
 * Harness fixtures in an ephemeral database; see om-prepare-test-env. The
 * ephemeral app is a production build, so its session cookie is Secure and has
 * to be carried explicitly (.ai/lessons.md → ephemeral-integration-env-gotchas).
 */
const CREDENTIALS = { email: 'admin@acme.com', password: 'secret' }

async function authedContext(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string | undefined,
): Promise<APIRequestContext> {
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
  return playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie } })
}

test.describe('MFA enrollment', () => {
  let request: APIRequestContext

  test.beforeAll(async ({ playwright, baseURL }) => {
    request = await authedContext(playwright, baseURL)
  })

  test.afterAll(async () => {
    await request?.dispose()
  })

  test('enrolling returns the secret, the otpauth URI and a scannable QR', async () => {
    const response = await request.post('/api/orva_mfa/enroll', { data: {} })
    expect(response.status(), await response.text()).toBe(200)
    const body = (await response.json()) as { secret?: string; otpauthUrl?: string; qrDataUrl?: string | null }

    expect(body.secret, 'the secret is shown exactly once, here').toMatch(/^[A-Z2-7]{16,}$/)
    expect(body.otpauthUrl).toContain('otpauth://totp/')
    expect(body.otpauthUrl).toContain(encodeURIComponent(body.secret ?? 'x').slice(0, 8))

    // The addition this spec exists for: a PNG the phone camera can read.
    expect(body.qrDataUrl, 'the QR must render in the built app').not.toBeNull()
    expect(String(body.qrDataUrl).startsWith('data:image/png;base64,')).toBe(true)
    expect(String(body.qrDataUrl).length).toBeGreaterThan(1000)
  })

  test('re-enrolling replaces the pending secret rather than failing', async () => {
    const first = (await (await request.post('/api/orva_mfa/enroll', { data: {} })).json()) as { secret: string }
    const second = (await (await request.post('/api/orva_mfa/enroll', { data: {} })).json()) as {
      secret: string
      qrDataUrl: string | null
    }
    expect(second.secret).not.toBe(first.secret)
    expect(second.qrDataUrl).not.toBeNull()
  })

  test('status reports the credential as pending until a code confirms it', async () => {
    await request.post('/api/orva_mfa/enroll', { data: {} })
    const status = await request.get('/api/orva_mfa/status')
    expect(status.status(), await status.text()).toBe(200)
    const body = (await status.json()) as Record<string, unknown>
    expect(JSON.stringify(body)).toContain('pending')
  })
})
