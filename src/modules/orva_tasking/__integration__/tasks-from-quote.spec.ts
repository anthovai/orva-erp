import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'

/**
 * The quotation's lines become the project's task list.
 *
 * What a customer was quoted is already the list of deliverables, written in
 * their words. This copies it once, and the copy has to be safe to press
 * twice: the operator will add a line to the quote and press it again, and
 * the project must gain one task, not a second set of six.
 *
 * The counts in the answer are the point of the test as much as the rows are
 * — the screen reports "added N, skipped M" to the operator, so a wrong
 * count is a lie told to somebody who is deciding whether to press again.
 *
 * The refusals matter too: a project with no quotation has nowhere to copy
 * from, and the quotation is taken from the project's own `quoteId` and
 * never from the request, so no caller can point a project at somebody
 * else's quote.
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

async function seed(request: APIRequestContext, projectId: string) {
  const res = await request.post('/api/orva_tasking/projects/tasks-from-quote', { data: { projectId } })
  return { status: res.status(), body: await readJson(res) }
}

async function taskTitles(request: APIRequestContext, projectId: string): Promise<string[]> {
  const list = await readJson(await request.get(`/api/orva_tasking/tasks?projectId=${projectId}&bucket=all`))
  return ((list.items ?? []) as Array<Json>).map((task) => String(task.title))
}

test.describe('a quotation seeds its project\'s tasks', () => {
  let request: APIRequestContext

  test.beforeAll(async ({ playwright, baseURL }) => { request = await login(playwright, baseURL) })
  test.afterAll(async () => { await request.dispose() })

  test('one task per line, once — pressing again adds only what is new', async () => {
    test.setTimeout(120_000)
    const stamp = Date.now().toString(36)

    const company = await request.post('/api/customers/companies', { data: { displayName: `บริษัท งานเว็บ ${stamp}` } })
    expect(company.status(), await company.text()).toBeLessThan(300)
    const customerEntityId = idOf(await readJson(company))

    const design = `ออกแบบหน้าเว็บไซต์ ${stamp}`
    const build = `พัฒนาเว็บไซต์ 5 หน้า ${stamp}`
    const quote = await request.post('/api/sales/quotes', {
      data: {
        currencyCode: 'THB', customerEntityId,
        lines: [
          { name: design, currencyCode: 'THB', quantity: 1, unitPriceNet: 6000, taxRate: 7 },
          { name: build, currencyCode: 'THB', quantity: 1, unitPriceNet: 12000, taxRate: 7 },
        ],
      },
    })
    expect(quote.status(), await quote.text()).toBeLessThan(300)
    const quoteId = idOf(await readJson(quote))

    const project = await request.post('/api/orva_tasking/projects', { data: { name: `โปรเจกต์เว็บ ${stamp}`, quoteId } })
    expect(project.status(), await project.text()).toBeLessThan(300)
    const projectId = idOf(await readJson(project))

    // A project starts with no tasks; the quotation supplies them.
    expect(await taskTitles(request, projectId)).toHaveLength(0)
    const first = await seed(request, projectId)
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    expect(first.body.added).toBe(2)
    expect(first.body.skipped).toBe(0)
    expect(first.body.total).toBe(2)
    expect(await taskTitles(request, projectId)).toEqual(expect.arrayContaining([design, build]))

    // Pressing again is a no-op, which is what makes the button safe to offer.
    const again = await seed(request, projectId)
    expect(again.body.added).toBe(0)
    expect(again.body.skipped).toBe(2)
    expect(await taskTitles(request, projectId)).toHaveLength(2)

    // A line added to the quotation later brings exactly one more task.
    const extra = `ติดตั้งขึ้นเซิร์ฟเวอร์ ${stamp}`
    const line = await request.post('/api/sales/quote-lines', {
      data: { quoteId, name: extra, currencyCode: 'THB', quantity: 1, unitPriceNet: 3000, taxRate: 7 },
    })
    expect(line.status(), await line.text()).toBeLessThan(300)
    const third = await seed(request, projectId)
    expect(third.body.added).toBe(1)
    expect(third.body.skipped).toBe(2)
    const titles = await taskTitles(request, projectId)
    expect(titles).toHaveLength(3)
    expect(titles).toContain(extra)

    // A task the operator renamed is not restored as a duplicate of its line…
    // …but a task they deleted from the list would come back, which is the
    // documented behaviour: the button seeds, it does not synchronise.
  })

  test('refuses a project with no quotation, and a project that is not there', async () => {
    test.setTimeout(120_000)
    const stamp = Date.now().toString(36)
    const internal = await request.post('/api/orva_tasking/projects', { data: { name: `งานภายใน ${stamp}` } })
    expect(internal.status(), await internal.text()).toBeLessThan(300)
    const internalId = idOf(await readJson(internal))

    const noQuote = await seed(request, internalId)
    expect(noQuote.status).toBe(400)
    expect(String(noQuote.body.error)).toContain('ใบเสนอราคา')
    expect(await taskTitles(request, internalId)).toHaveLength(0)

    const missing = await seed(request, '00000000-0000-4000-8000-000000000000')
    expect(missing.status).toBe(404)
  })
})
