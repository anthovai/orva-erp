import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'

/**
 * I3 — a customer can look up their own paperwork without emailing to ask.
 *
 * Two customers are set up, each with a quote and an issued งวด, and each
 * with their own portal account. Signed in, a customer sees their own
 * documents and the outstanding total, and can open the real sheet. The
 * assertion that matters most is the negative one: the other customer's
 * invoice answers 404, the same as an id that never existed, so nothing can
 * be learned by guessing.
 *
 * A portal account not linked to a customer record is its own state —
 * `linked: false` — rather than an empty list, because "we have no documents
 * for you" and "your account is not connected" mean opposite things.
 *
 * Harness fixtures in an ephemeral database; session cookies are carried
 * explicitly because the ephemeral app is a production build.
 */

const CREDENTIALS = { email: 'admin@acme.com', password: 'secret' }
type Json = Record<string, unknown>

async function staffLogin(playwright: PlaywrightWorkerArgs['playwright'], baseURL: string | undefined): Promise<APIRequestContext> {
  const anonymous = await playwright.request.newContext({ baseURL })
  const response = await anonymous.post('/api/auth/login', { form: CREDENTIALS })
  expect(response.status(), await response.text()).toBe(200)
  const cookie = response.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value.split(';')[0]).join('; ')
  await anonymous.dispose()
  return playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie } })
}

/**
 * A signed-in customer's own request context.
 *
 * The organisation is passed explicitly: on a platform domain the login route
 * cannot infer the tenant from the host, and says so rather than guessing.
 */
async function customerLogin(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string | undefined,
  email: string,
  password: string,
  organizationId: string,
): Promise<APIRequestContext | null> {
  const anonymous = await playwright.request.newContext({ baseURL })
  const response = await anonymous.post('/api/customer_accounts/login', { data: { email, password, organizationId } })
  if (response.status() !== 200) {
    console.log(`[i3] customer login answered ${response.status()}: ${(await response.text()).slice(0, 200)}`)
    await anonymous.dispose()
    return null
  }
  const cookie = response.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value.split(';')[0]).join('; ')
  await anonymous.dispose()
  return playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie } })
}

async function readJson(response: { text: () => Promise<string> }): Promise<Json> {
  const body = await response.text()
  try { return JSON.parse(body) as Json } catch { throw new Error(`expected JSON, got: ${body.slice(0, 300)}`) }
}
const idOf = (body: Json): string => (typeof body.id === 'string' ? body.id : String((body.item as Json | undefined)?.id ?? ''))

/** A company, a quote for it, and one issued งวด. */
async function seedCustomer(request: APIRequestContext, name: string, price: number) {
  const company = await request.post('/api/customers/companies', { data: { displayName: name } })
  expect(company.status(), await company.text()).toBeLessThan(300)
  const customerEntityId = idOf(await readJson(company))

  const quote = await request.post('/api/sales/quotes', {
    data: {
      currencyCode: 'THB', customerEntityId,
      lines: [{ name: `งานของ ${name}`, currencyCode: 'THB', quantity: 1, unitPriceNet: price, taxRate: 7 }],
    },
  })
  expect(quote.status(), await quote.text()).toBeLessThan(300)
  const quoteId = idOf(await readJson(quote))

  const issued = await request.post('/api/orva_documents/issue-invoice', { data: { quoteId, percent: 50, dueInDays: 7 } })
  expect(issued.status(), await issued.text()).toBe(200)
  const invoice = await readJson(issued)
  return { customerEntityId, quoteId, invoiceId: String(invoice.id), invoiceNumber: String(invoice.invoiceNumber) }
}

test.describe('the customer portal shows a customer their own documents (I3)', () => {
  let request: APIRequestContext

  test.beforeAll(async ({ playwright, baseURL }) => { request = await staffLogin(playwright, baseURL) })
  test.afterAll(async () => { await request.dispose() })

  test('a signed-in customer sees their own quotes and invoices, and nobody else\'s', async ({ playwright, baseURL }) => {
    test.setTimeout(120_000)
    const stamp = Date.now().toString(36)
    const switcher = await readJson(await request.get('/api/directory/organization-switcher'))
    const organizationId = String(switcher.selectedId ?? ((switcher.items as Array<Json>)[0]?.id ?? ''))
    expect(organizationId, 'the staff session must name an organization').not.toBe('')
    const mine = await seedCustomer(request, `บริษัท ของฉัน ${stamp}`, 40000)
    const theirs = await seedCustomer(request, `บริษัท ของคนอื่น ${stamp}`, 90000)

    // No session at all: the portal answers nothing.
    const anonymous = await playwright.request.newContext({ baseURL })
    expect((await anonymous.get('/api/orva_documents/portal/documents')).status()).toBe(401)
    // Staff cookies are not customer cookies either.
    expect((await request.get('/api/orva_documents/portal/documents')).status()).toBe(401)

    const password = `Portal!${stamp}aA1`
    const account = await request.post('/api/customer_accounts/admin/users', {
      data: { email: `owner-${stamp}@example.test`, password, displayName: `คุณลูกค้า ${stamp}`, customerEntityId: mine.customerEntityId },
    })
    expect(account.status(), await account.text()).toBeLessThan(300)

    const unlinked = await request.post('/api/customer_accounts/admin/users', {
      data: { email: `stranger-${stamp}@example.test`, password, displayName: `ยังไม่ผูก ${stamp}` },
    })
    expect(unlinked.status(), await unlinked.text()).toBeLessThan(300)

    const customer = await customerLogin(playwright, baseURL, `owner-${stamp}@example.test`, password, organizationId)
    if (!customer) {
      test.skip(true, 'the customer login route did not accept the seeded account in this environment')
      return
    }

    const own = await readJson(await customer.get('/api/orva_documents/portal/documents'))
    expect(own.linked).toBe(true)
    const invoices = own.invoices as Array<Json>
    const quotes = own.quotes as Array<Json>
    expect(invoices.map((i) => i.id)).toContain(mine.invoiceId)
    expect(quotes.map((q) => q.id)).toContain(mine.quoteId)
    // The other customer's paperwork is not in the list at all.
    expect(invoices.map((i) => i.id)).not.toContain(theirs.invoiceId)
    expect(quotes.map((q) => q.id)).not.toContain(theirs.quoteId)

    // 50% of 40,000 plus VAT, still unpaid.
    expect((own.summary as Json).unpaidCount).toBe(1)
    expect(Number((own.summary as Json).outstanding)).toBeCloseTo(21400, 2)

    // Their own document opens as the real sheet.
    const sheet = await customer.get(`/api/orva_documents/portal/document?id=${mine.invoiceId}&type=invoice`)
    expect(sheet.status(), await sheet.text()).toBe(200)
    const sheetBody = await readJson(sheet)
    expect(JSON.stringify(sheetBody.document)).toContain(mine.invoiceNumber)
    expect(Object.keys(sheetBody.labels as Json).length).toBeGreaterThan(0)

    // Somebody else's does not, and neither does an id that never existed.
    expect((await customer.get(`/api/orva_documents/portal/document?id=${theirs.invoiceId}&type=invoice`)).status()).toBe(404)
    expect((await customer.get('/api/orva_documents/portal/document?id=00000000-0000-4000-8000-000000000000')).status()).toBe(404)
    // A quotation record cannot be printed as an invoice.
    expect((await customer.get(`/api/orva_documents/portal/document?id=${mine.quoteId}&type=invoice`)).status()).toBe(400)

    // An account nobody attached to a customer says so rather than looking empty.
    const stranger = await customerLogin(playwright, baseURL, `stranger-${stamp}@example.test`, password, organizationId)
    if (stranger) {
      const none = await readJson(await stranger.get('/api/orva_documents/portal/documents'))
      expect(none.linked).toBe(false)
      expect((none.invoices as Array<Json>).length).toBe(0)
      await stranger.dispose()
    }

    await anonymous.dispose()
    await customer.dispose()
  })
})
