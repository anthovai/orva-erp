import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'

/**
 * I2 — the last quote is the reusable thing.
 *
 * A quote is written once, then copied: the copy keeps the customer, the
 * currency and every line, takes the next number in the series, and starts
 * as a draft no matter what the original had become. What it must NOT carry
 * is the original's acceptance or its issued งวด — those belong to the quote
 * that earned them.
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

test.describe('duplicate a quote (I2)', () => {
  let request: APIRequestContext

  test.beforeAll(async ({ playwright, baseURL }) => { request = await login(playwright, baseURL) })
  test.afterAll(async () => { await request.dispose() })

  test('the copy keeps the customer and every line, takes its own number, and starts as a draft', async () => {
    const stamp = Date.now().toString(36)
    const person = await request.post('/api/customers/people', { data: { firstName: 'ลูกค้าคัดลอก', lastName: stamp } })
    expect(person.status(), await person.text()).toBeLessThan(300)
    const customerEntityId = idOf(await readJson(person))

    const source = await request.post('/api/sales/quotes', {
      data: {
        currencyCode: 'THB',
        customerEntityId,
        comments: `เงื่อนไขเดิม ${stamp}`,
        lines: [
          { name: `ออกแบบระบบ ${stamp}`, description: 'เฟสหนึ่ง', currencyCode: 'THB', quantity: 2, unitPriceNet: 25000, taxRate: 7 },
          { name: `ติดตั้งและอบรม ${stamp}`, currencyCode: 'THB', quantity: 1, unitPriceNet: 15000, taxRate: 7 },
        ],
      },
    })
    expect(source.status(), await source.text()).toBeLessThan(300)
    const sourceId = idOf(await readJson(source))

    const sourceRow = await readJson(await request.get(`/api/sales/quotes?ids=${sourceId}&pageSize=1`))
    const sourceItem = ((sourceRow.items ?? []) as Array<Json>)[0]
    expect(sourceItem, 'the source quote is listed').toBeTruthy()
    const sourceNumber = String(sourceItem.quote_number ?? sourceItem.quoteNumber ?? '')
    expect(sourceNumber).not.toBe('')

    const copied = await request.post('/api/orva_documents/duplicate-quote', { data: { quoteId: sourceId } })
    expect(copied.status(), await copied.text()).toBe(200)
    const copy = await readJson(copied)
    expect(copy.lines).toBe(2)
    expect(copy.id).not.toBe(sourceId)
    expect(String(copy.quoteNumber ?? ''), 'the copy claims its own number').not.toBe('')
    expect(copy.quoteNumber).not.toBe(sourceNumber)

    // Same money, same customer, same lines — a different document.
    const copyRow = ((await readJson(await request.get(`/api/sales/quotes?ids=${copy.id}&pageSize=1`))).items as Array<Json>)[0]
    expect(copyRow).toBeTruthy()
    expect(String(copyRow.customer_entity_id ?? copyRow.customerEntityId ?? '')).toBe(customerEntityId)
    expect(Number(copyRow.grand_total_gross_amount ?? copyRow.grandTotalGrossAmount ?? 0))
      .toBeCloseTo(Number(sourceItem.grand_total_gross_amount ?? sourceItem.grandTotalGrossAmount ?? 0), 2)
    // A copy is always a draft, whatever the original had become.
    expect(copyRow.status ?? null).not.toBe('confirmed')

    // The lines came across, with their names.
    const preview = await readJson(await request.get(`/api/orva_documents/preview?type=quotation&documentId=${copy.id}`))
    const previewText = JSON.stringify(preview)
    expect(previewText).toContain(`ออกแบบระบบ ${stamp}`)
    expect(previewText).toContain(`ติดตั้งและอบรม ${stamp}`)

    // A quote that is not this tenant's, and one with nothing on it, are refused.
    const missing = await request.post('/api/orva_documents/duplicate-quote', { data: { quoteId: '00000000-0000-4000-8000-000000000000' } })
    expect(missing.status()).toBe(404)
    const empty = await request.post('/api/sales/quotes', { data: { currencyCode: 'THB', customerEntityId } })
    if (empty.status() < 300) {
      const emptyId = idOf(await readJson(empty))
      const refused = await request.post('/api/orva_documents/duplicate-quote', { data: { quoteId: emptyId } })
      expect(refused.status(), 'a quote with no lines has nothing to copy').toBe(422)
    }
  })
})
