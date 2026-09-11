import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'

/**
 * I2, second half — the home screen says whether a quote is waiting on the
 * customer or on us.
 *
 * A quote that has been sent and not answered used to look exactly like one
 * written five minutes ago: both were "open". The waiting card now carries
 * the send history from `orva_documents_sends`, so it can say "sent 9 days
 * ago, no answer" or "never sent".
 *
 * What this spec proves end to end is the wiring: a real quote reaches the
 * card with its follow-up verdict and send count attached, and a quote that
 * has been billed leaves the card entirely. The verdicts themselves — the
 * cadence, the expiry precedence, the day arithmetic — are covered
 * exhaustively by the unit tests, because reaching the "sent 9 days ago"
 * state here would need an email actually sent nine days ago.
 *
 * Harness fixtures in an ephemeral database; the session cookie is carried
 * explicitly because the ephemeral app is a production build.
 */

const CREDENTIALS = { email: 'admin@acme.com', password: 'secret' }
type Json = Record<string, unknown>

async function login(playwright: PlaywrightWorkerArgs['playwright'], baseURL: string | undefined): Promise<APIRequestContext> {
  const anonymous = await playwright.request.newContext({ baseURL })
  const response = await anonymous.post('/api/auth/login', { form: CREDENTIALS })
  expect(response.status(), await response.text()).toBe(200)
  const cookie = response.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value.split(';')[0]).join('; ')
  await anonymous.dispose()
  return playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie } })
}

async function readJson(response: { text: () => Promise<string> }): Promise<Json> {
  const body = await response.text()
  try { return JSON.parse(body) as Json } catch { throw new Error(`expected JSON, got: ${body.slice(0, 300)}`) }
}
const idOf = (body: Json): string => (typeof body.id === 'string' ? body.id : String((body.item as Json | undefined)?.id ?? ''))

const waitingQuotes = async (request: APIRequestContext): Promise<Array<Json>> => {
  const overview = await request.get('/api/orva_finance/home/overview')
  expect(overview.status(), await overview.text()).toBe(200)
  const body = await readJson(overview)
  return ((body.waiting as Json | undefined)?.quotes ?? []) as Array<Json>
}

test.describe('quote follow-up on the waiting card (I2)', () => {
  let request: APIRequestContext

  test.beforeAll(async ({ playwright, baseURL }) => { request = await login(playwright, baseURL) })
  test.afterAll(async () => { await request.dispose() })

  test('an unanswered quote reaches the card with its follow-up state, and a billed one leaves it', async () => {
    const stamp = Date.now().toString(36)
    const person = await request.post('/api/customers/people', { data: { firstName: 'ลูกค้าติดตาม', lastName: stamp } })
    expect(person.status(), await person.text()).toBeLessThan(300)
    const customerEntityId = idOf(await readJson(person))

    const quote = await request.post('/api/sales/quotes', {
      data: {
        currencyCode: 'THB',
        customerEntityId,
        lines: [{ name: `งานติดตาม ${stamp}`, currencyCode: 'THB', quantity: 1, unitPriceNet: 40000, taxRate: 7 }],
      },
    })
    expect(quote.status(), await quote.text()).toBeLessThan(300)
    const quoteId = idOf(await readJson(quote))

    const mine = (await waitingQuotes(request)).find((q) => q.id === quoteId)
    expect(mine, 'a quote nobody has answered is on the waiting card').toBeTruthy()
    // Written just now and never emailed: the ball is not yet in our court,
    // and the card says so rather than nagging on day zero.
    expect(mine).toMatchObject({ followUp: 'waiting', lastSentOn: null, daysSinceSent: null, sendCount: 0 })
    expect(Number(mine!.total)).toBeCloseTo(42800, 2)

    // Issue a งวด against it: the quote is now being billed, so it is no
    // longer something the customer owes us an answer on.
    const issued = await request.post('/api/orva_documents/issue-invoice', { data: { quoteId, percent: 50, dueInDays: 7 } })
    expect(issued.status(), await issued.text()).toBe(200)

    const after = (await waitingQuotes(request)).find((q) => q.id === quoteId)
    expect(after, 'a quote that has been billed leaves the waiting card').toBeFalsy()
  })
})
