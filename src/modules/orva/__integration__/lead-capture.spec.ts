import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'

/**
 * A web enquiry has to reach the owner.
 *
 * Phase G4 shipped the public form and it created a deal silently: no
 * notification, no event, nothing on the home screen. For a one-person company
 * that is the whole feature missing its point — an enquiry at two in the
 * morning waits in a pipeline nobody opens until Thursday. These specs prove
 * the loop is closed now, and prove it through the public route with no
 * session, exactly as a stranger would submit it.
 *
 * Harness fixtures in an ephemeral database; the ephemeral app is a production
 * build, so the session cookie for the authenticated half has to be carried
 * explicitly (.ai/lessons.md → ephemeral-integration-env-gotchas).
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
  await anonymous.dispose()
  return playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie } })
}

/**
 * The seeded organization's slug: scope comes from it, never from the payload.
 *
 * `view=manage` is the branch of the directory list that carries slugs; the
 * default `options` view returns names and ids only, which is what a fixture
 * asking for the obvious endpoint gets wrong first.
 */
async function orgSlug(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/directory/organizations?page=1&pageSize=50&view=manage')
  expect(response.status(), await response.text()).toBe(200)
  const body = (await response.json()) as { items?: Array<{ slug?: string | null }> }
  const slug = (body.items ?? []).map((item) => item.slug).find((value) => Boolean(value))
  expect(slug, 'the seeded tenant needs an organization with a slug').toBeTruthy()
  return String(slug)
}

test.describe('lead capture reaches the owner', () => {
  let authed: APIRequestContext
  let slug: string

  test.beforeAll(async ({ playwright, baseURL }) => {
    authed = await authedContext(playwright, baseURL)
    slug = await orgSlug(authed)
  })

  test.afterAll(async () => {
    await authed?.dispose()
  })

  test('a public enquiry becomes a deal, a notification and a home-screen row', async ({ request }) => {
    const stamp = Date.now()
    const email = `integration.lead.${stamp}@example.com`

    // Anonymous, exactly as the portal form posts it.
    const submitted = await request.post('/api/orva/lead', {
      data: {
        orgSlug: slug,
        name: 'คุณทดสอบ ระบบ',
        company: `Integration Co ${stamp}`,
        email,
        phone: '020000000',
        message: 'สนใจให้ทำเว็บแอป',
        source: 'เว็บไซต์',
      },
    })
    expect(submitted.status(), await submitted.text()).toBe(200)
    expect((await submitted.json()) as Record<string, unknown>).toMatchObject({ ok: true })

    // The deal exists on the pipeline with the channel filled in.
    const deals = await authed.get('/api/customers/deals?page=1&pageSize=50')
    expect(deals.status(), await deals.text()).toBe(200)
    const dealItems = ((await deals.json()) as { items?: Array<Record<string, unknown>> }).items ?? []
    const deal = dealItems.find((row) => String(row.title ?? '').includes(`Integration Co ${stamp}`))
    expect(deal, 'the enquiry must appear on the pipeline').toBeTruthy()

    // The notification is the part that was missing.
    const notifications = await authed.get('/api/notifications?page=1&pageSize=50')
    expect(notifications.status(), await notifications.text()).toBe(200)
    const raised = JSON.stringify((await notifications.json()) ?? {})
    expect(raised, 'a captured lead must raise orva.lead.received').toContain('orva.lead.received')

    // And the home screen counts it as waiting on somebody.
    const overview = await authed.get('/api/orva_finance/home/overview')
    expect(overview.status(), await overview.text()).toBe(200)
    const waiting = ((await overview.json()) as { waiting?: { untouchedLeads?: number } }).waiting
    expect(waiting?.untouchedLeads ?? 0).toBeGreaterThan(0)
  })

  test('a repeat submission within the window does not notify twice', async ({ request }) => {
    const stamp = Date.now()
    const payload = {
      orgSlug: slug,
      name: 'คุณส่งซ้ำ',
      company: `Duplicate Co ${stamp}`,
      email: `integration.dupe.${stamp}@example.com`,
      message: 'ส่งซ้ำ',
      source: 'LINE',
    }
    expect((await request.post('/api/orva/lead', { data: payload })).status()).toBe(200)
    expect((await request.post('/api/orva/lead', { data: payload })).status()).toBe(200)

    const deals = await authed.get('/api/customers/deals?page=1&pageSize=100')
    const items = ((await deals.json()) as { items?: Array<Record<string, unknown>> }).items ?? []
    const matches = items.filter((row) => String(row.title ?? '').includes(`Duplicate Co ${stamp}`))
    expect(matches.length, 'the second submission appends rather than opening a second deal').toBe(1)
  })

  test('a bot filling the honeypot is accepted and silently dropped', async ({ request }) => {
    const stamp = Date.now()
    const response = await request.post('/api/orva/lead', {
      data: {
        orgSlug: slug,
        name: 'Bot',
        company: `Bot Co ${stamp}`,
        email: `bot.${stamp}@example.com`,
        message: 'spam',
        // The hidden field a human never sees and never fills. It is called
        // `website` in the schema, which is the point of a honeypot: a bot
        // that fills every field it finds fills this one too.
        website: 'http://spam.example',
      },
    })
    // Always 200: the response must reveal nothing about what happened.
    expect(response.status()).toBe(200)

    const deals = await authed.get('/api/customers/deals?page=1&pageSize=100')
    const items = ((await deals.json()) as { items?: Array<Record<string, unknown>> }).items ?? []
    expect(items.some((row) => String(row.title ?? '').includes(`Bot Co ${stamp}`))).toBe(false)
  })

  test('an unknown organization slug is refused without leaking whether it exists', async ({ request }) => {
    const response = await request.post('/api/orva/lead', {
      data: {
        orgSlug: 'no-such-organization-anywhere',
        name: 'X',
        email: 'x@example.com',
        message: 'x',
      },
    })
    expect(response.status()).toBe(404)
  })
})
