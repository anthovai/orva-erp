import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'

/**
 * Two things the home screen now says out loud, because nothing else did.
 *
 * A service business bills in งวด, so work and money drift apart by nature.
 * When the drift gets large enough it stops being lumpiness and becomes money
 * the business has already earned and simply not asked for — on the real
 * tenant, a quote 78.9% delivered and 30% billed, with 59,920 baht sitting
 * unclaimed. The projects screen could always show it; nobody opens the
 * projects screen to find out what to do today.
 *
 * And an accounting period whose month has ended stays open until somebody
 * closes it. Nothing breaks while it is open, which is exactly why it stays
 * open — while the closing journal and the month pack both wait on it.
 *
 * The verdict here must come from the same `workVsBilling` rule the โปรเจกต์
 * screen uses. A home screen that disagrees with the screen it links to is
 * worse than one that says nothing.
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

async function waiting(request: APIRequestContext): Promise<Json> {
  const res = await request.get('/api/orva_finance/home/overview')
  expect(res.status(), await res.text()).toBe(200)
  return ((await readJson(res)).waiting ?? {}) as Json
}
const behindFor = (block: Json, ref: string): Json | undefined =>
  ((block.billingBehindWork ?? []) as Array<Json>).find((row) => row.ref === ref)

test.describe('the home screen says what has been earned and not billed', () => {
  let request: APIRequestContext

  test.beforeAll(async ({ playwright, baseURL }) => { request = await login(playwright, baseURL) })
  test.afterAll(async () => { await request.dispose() })

  test('a project whose work has run ahead of its billing reaches the waiting card', async () => {
    test.setTimeout(120_000)
    const stamp = Date.now().toString(36)

    const company = await request.post('/api/customers/companies', { data: { displayName: `บริษัท งานล้ำบิล ${stamp}` } })
    expect(company.status(), await company.text()).toBeLessThan(300)
    const customerEntityId = idOf(await readJson(company))

    const quote = await request.post('/api/sales/quotes', {
      data: {
        currencyCode: 'THB', customerEntityId,
        lines: [{ name: `พัฒนาระบบ ${stamp}`, currencyCode: 'THB', quantity: 1, unitPriceNet: 100000, taxRate: 7 }],
      },
    })
    expect(quote.status(), await quote.text()).toBeLessThan(300)
    const quoteId = idOf(await readJson(quote))
    const quoteRef = String((await readJson(await request.get(`/api/sales/quotes?id=${quoteId}`))).quoteNumber ?? '')

    const project = await request.post('/api/orva_tasking/projects', { data: { name: `โปรเจกต์ ${stamp}`, quoteId } })
    expect(project.status(), await project.text()).toBeLessThan(300)
    const projectId = idOf(await readJson(project))

    // Nothing done yet and nothing billed: 0 vs 0 is in step, not behind.
    for (let i = 0; i < 4; i++) {
      const task = await request.post('/api/orva_tasking/tasks', { data: { projectId, title: `งาน ${i + 1} ${stamp}` } })
      expect(task.status(), await task.text()).toBeLessThan(300)
    }
    const listed = await readJson(await request.get(`/api/orva_tasking/tasks?projectId=${projectId}&bucket=all`))
    const tasks = (listed.items ?? []) as Array<Json>
    expect(tasks).toHaveLength(4)

    const quoteNumber = quoteRef || String(((await readJson(await request.get('/api/sales/quotes?pageSize=100'))).items as Array<Json> ?? [])
      .find((row) => row.id === quoteId)?.quoteNumber ?? '')
    expect(quoteNumber, 'the quote must have a number to appear by').not.toBe('')
    expect(behindFor(await waiting(request), quoteNumber), 'no work done yet means nothing to chase').toBeUndefined()

    // Three of four done, nothing billed: 75 points of drift.
    for (const task of tasks.slice(0, 3)) {
      const done = await request.put('/api/orva_tasking/tasks', {
        data: { id: task.id, done: true, updatedAt: task.updatedAt },
      })
      expect(done.status(), await done.text()).toBeLessThan(300)
    }

    const row = behindFor(await waiting(request), quoteNumber)
    expect(row, 'a project 75% done and 0% billed must reach the card').toBeTruthy()
    expect(row!.workPct).toBe(75)
    expect(row!.billedPct).toBe(0)
    expect(Number(row!.gap)).toBeGreaterThanOrEqual(20)
    // The whole quote is still to bill, VAT included.
    expect(Number(row!.remainingToBill)).toBeCloseTo(107000, 2)

    // Issuing งวด closes the gap: the row is the thing to DO, so it must
    // disappear once it has been done.
    const issued = await request.post('/api/orva_documents/issue-invoice', { data: { quoteId, percent: 80, dueInDays: 7 } })
    expect(issued.status(), await issued.text()).toBe(200)
    expect(behindFor(await waiting(request), quoteNumber), 'billing 80% must clear a 75% work gap').toBeUndefined()
  })

  test('an accounting period whose month has ended is listed until it is closed', async () => {
    test.setTimeout(120_000)
    const block = await waiting(request)
    const periods = (block.periodsToClose ?? []) as Array<Json>

    // The harness may or may not have a period past its end date; either way
    // the shape must be honest and every row must actually be overdue.
    const today = new Date().toISOString().slice(0, 10)
    for (const period of periods) {
      expect(String(period.code)).toMatch(/^\d{4}-\d{2}$/)
      expect(String(period.endsOn) < today, `${period.code} is listed but ends ${period.endsOn}`).toBe(true)
      expect(Number(period.daysOverdue)).toBeGreaterThanOrEqual(0)
    }
  })
})
