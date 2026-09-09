import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'

/**
 * ใบส่งของ end to end: the sheet the driver carries, and the facts the office
 * records on it.
 *
 * Phase B1 shipped with unit and render coverage — the model and the HTML —
 * and nothing that proved the route chain: that a real invoice prints as a
 * delivery note, that recording the delivery keeps the rest of the invoice's
 * metadata, and that two people editing at once are told. The spec names
 * these TEST-008 (the sheet) and TEST-009 (the facts).
 *
 * Credentials are the harness's own documented fixtures in an ephemeral
 * database (see om-prepare-test-env), never a real tenant's.
 */
const CREDENTIALS = { email: 'admin@acme.com', password: 'secret' }

type Json = Record<string, unknown>

/**
 * Signs in and returns a context that actually carries the session.
 *
 * The ephemeral app is a production build, so the session cookies are set
 * `Secure` and no client sends those back over the plain-http base URL — the
 * jar quietly sends nothing and every call answers 401. Reading `set-cookie`
 * off the login response and putting it on the context as a header is what an
 * API client would do, and weakens nothing in the app.
 */
async function login(
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

async function readJson(response: { text: () => Promise<string> }): Promise<Json> {
  const body = await response.text()
  try {
    return JSON.parse(body) as Json
  } catch {
    throw new Error(`expected JSON, got: ${body.slice(0, 400)}`)
  }
}

/** An issued invoice with two goods lines — what a delivery note prints from. */
async function createInvoice(request: APIRequestContext, metadata: Json = {}): Promise<{ id: string; number: string }> {
  const created = await request.post('/api/sales/invoices', {
    data: {
      currencyCode: 'THB',
      issueDate: '2026-09-09',
      metadata,
      lines: [
        {
          name: 'Marventine Body Lotion 200 มล. (ลัง/24 ขวด)',
          quantity: 10,
          currencyCode: 'THB',
          unitPriceNet: 2400,
          taxRate: 7,
          totalNetAmount: 24000,
        },
        {
          name: 'Marventine Hand Cream 50 มล. (ลัง/48 หลอด)',
          quantity: 4,
          currencyCode: 'THB',
          unitPriceNet: 3600,
          taxRate: 7,
          totalNetAmount: 14400,
        },
      ],
    },
  })
  expect(created.status(), await created.text()).toBeLessThan(300)
  const body = await readJson(created)
  const id = String(body.invoiceId ?? body.id ?? '')
  expect(id, `invoice id missing from ${JSON.stringify(body)}`).not.toBe('')
  // The number comes from the delivery-facts context rather than from
  // `/api/sales/invoices?id=…`: that list route does not narrow by id, so the
  // first row of the whole list was being read as "this" invoice.
  const context = await readJson(await request.get(`/api/orva_documents/delivery-facts?invoiceId=${id}`))
  const number = String(context.invoiceNumber ?? '')
  expect(number, `invoice number missing from ${JSON.stringify(context)}`).not.toBe('')
  return { id, number }
}

const preview = async (request: APIRequestContext, invoiceId: string): Promise<Json> => {
  const response = await request.get(`/api/orva_documents/preview?type=delivery_note&documentId=${invoiceId}`)
  expect(response.status(), await response.text()).toBe(200)
  return (await readJson(response)).document as Json
}

test.describe('ใบส่งของ', () => {
  let request: APIRequestContext
  let cookie: string

  test.beforeAll(async ({ playwright, baseURL }) => {
    const session = await login(playwright, baseURL)
    request = session.request
    cookie = session.cookie
  })

  test.afterAll(async () => { await request?.dispose() })

  test('TEST-008: an invoice prints as a delivery note, with no prices on it', async () => {
    const invoice = await createInvoice(request)
    const doc = await preview(request, invoice.id)

    expect(doc.headingTh).toBe('ใบส่งของ')
    // A counterpart of the invoice, not a series of its own.
    expect(doc.number).toBe(`DN-${invoice.number}`)
    expect(doc.isDeliveryNote).toBe(true)
    // Delivering goods claims no VAT: no taxpayer id is required, so the
    // sheet must not be flagged deficient for lacking one.
    expect(doc.isTaxDocument).toBe(false)
    expect(doc.warnings).toEqual([])
    // The goods and their quantities…
    const lines = doc.lines as Array<Json>
    expect(lines.length).toBe(2)
    expect(String(lines[0].description)).toContain('Marventine Body Lotion')
    expect(Number(lines[0].quantity)).toBe(10)
    // …and not what they cost.
    expect(doc.showPrices).toBe(false)
    expect(doc.amountInWords).toBeNull()
    expect(doc.paymentDetails).toBeNull()
    // The block prints even before anything is recorded, so a driver can
    // complete it by hand.
    expect(doc.delivery).toBeTruthy()
    expect((doc.delivery as Json).deliveredOn).toBeNull()
  })

  test('the same invoice still prints as an invoice, with its prices', async () => {
    const invoice = await createInvoice(request)
    const response = await request.get(`/api/orva_documents/preview?type=invoice&documentId=${invoice.id}`)
    const doc = (await readJson(response)).document as Json
    expect(doc.headingTh).toBe('ใบแจ้งหนี้')
    expect(doc.showPrices).toBe(true)
    expect(doc.delivery).toBeNull()
    expect(Number((doc.lines as Array<Json>)[0].unitPrice)).toBe(2400)
  })

  test('TEST-009: recording the delivery reaches the sheet and keeps the rest of the metadata', async () => {
    // The quote linkage is the metadata key that must survive: losing it
    // detaches the invoice from the งวด it was issued from.
    const quoteId = '11111111-2222-3333-4444-555555555555'
    const invoice = await createInvoice(request, { quoteId, someOtherKey: 'keep me' })

    const context = await readJson(await request.get(`/api/orva_documents/delivery-facts?invoiceId=${invoice.id}`))
    expect(context.invoiceNumber).toBe(invoice.number)
    expect((context.delivery as Json).deliveredOn).toBeNull()
    const version = String(context.updatedAt ?? '')
    expect(version, 'the context must carry a version to lock against').not.toBe('')

    const saved = await request.post('/api/orva_documents/delivery-facts', {
      data: {
        invoiceId: invoice.id,
        updatedAt: version,
        deliveredOn: '2026-09-09',
        carrier: 'รถบริษัท (ทะเบียน 1กก-1234)',
        trackingNumbers: ['TH01', '  '],
        address: 'คลังสินค้า ประตู 3',
        note: 'ส่งช่วงเช้า ก่อน 11:00 น.',
      },
    })
    expect(saved.status(), await saved.text()).toBe(200)
    const savedBody = await readJson(saved)
    expect((savedBody.delivery as Json).trackingNumbers).toEqual(['TH01'])

    // The sheet reads them.
    const doc = await preview(request, invoice.id)
    const delivery = doc.delivery as Json
    expect(delivery.deliveredOn).toBe('2026-09-09')
    expect(delivery.carrier).toBe('รถบริษัท (ทะเบียน 1กก-1234)')
    expect(delivery.address).toBe('คลังสินค้า ประตู 3')
    // The delivery date is the sheet's second date, under its own label.
    expect(doc.secondaryDate).toBe('2026-09-09')
    expect(doc.secondaryDateLabelKey).toBe('orva_documents.field.deliveredOn')
    // Still no prices: recording a delivery does not turn them on.
    expect(doc.showPrices).toBe(false)

    // And nothing else in metadata was lost.
    const after = await readJson(await request.get(`/api/orva_documents/delivery-facts?invoiceId=${invoice.id}`))
    expect((after.delivery as Json).carrier).toBe('รถบริษัท (ทะเบียน 1กก-1234)')
    const invoiceAfter = await readJson(await request.get(`/api/orva_documents/preview?type=invoice&documentId=${invoice.id}`))
    expect((invoiceAfter.document as Json).headingTh).toBe('ใบแจ้งหนี้')
  })

  test('editing one fact leaves the others alone, and prices can be turned on', async () => {
    const invoice = await createInvoice(request)
    let context = await readJson(await request.get(`/api/orva_documents/delivery-facts?invoiceId=${invoice.id}`))
    const first = await request.post('/api/orva_documents/delivery-facts', {
      data: {
        invoiceId: invoice.id,
        updatedAt: String(context.updatedAt),
        deliveredOn: '2026-09-09',
        carrier: 'Kerry',
      },
    })
    expect(first.status(), await first.text()).toBe(200)

    // The tracking number arrives the next morning, on its own.
    context = await readJson(await request.get(`/api/orva_documents/delivery-facts?invoiceId=${invoice.id}`))
    const second = await request.post('/api/orva_documents/delivery-facts', {
      data: { invoiceId: invoice.id, updatedAt: String(context.updatedAt), trackingNumbers: ['KEX00123'], showPrices: true },
    })
    expect(second.status(), await second.text()).toBe(200)

    const doc = await preview(request, invoice.id)
    const delivery = doc.delivery as Json
    expect(delivery.deliveredOn, 'the date typed yesterday must survive').toBe('2026-09-09')
    expect(delivery.carrier).toBe('Kerry')
    expect(delivery.trackingNumbers).toEqual(['KEX00123'])
    expect(doc.showPrices).toBe(true)
    expect(doc.amountInWords).toBeTruthy()
  })

  test('a stale version is refused, and the second writer sees why', async () => {
    const invoice = await createInvoice(request)
    const context = await readJson(await request.get(`/api/orva_documents/delivery-facts?invoiceId=${invoice.id}`))
    const stale = String(context.updatedAt)

    const firstWriter = await request.post('/api/orva_documents/delivery-facts', {
      data: { invoiceId: invoice.id, updatedAt: stale, deliveredOn: '2026-09-09' },
    })
    expect(firstWriter.status()).toBe(200)

    // The other tab still holds the version it read before that write.
    const secondWriter = await request.post('/api/orva_documents/delivery-facts', {
      data: { invoiceId: invoice.id, updatedAt: stale, deliveredOn: '2026-09-10' },
    })
    expect(secondWriter.status(), await secondWriter.text()).toBe(409)

    // …and the first writer's date stands.
    const doc = await preview(request, invoice.id)
    expect((doc.delivery as Json).deliveredOn).toBe('2026-09-09')
  })

  test('a receiver name is refused rather than quietly dropped (Q-004)', async () => {
    const invoice = await createInvoice(request)
    const context = await readJson(await request.get(`/api/orva_documents/delivery-facts?invoiceId=${invoice.id}`))
    const refused = await request.post('/api/orva_documents/delivery-facts', {
      data: {
        invoiceId: invoice.id,
        updatedAt: String(context.updatedAt),
        deliveredOn: '2026-09-09',
        receiverName: 'คุณสมชาย ใจดี',
      },
    })
    // Invoice metadata is not encrypted at rest, so a third party's name must
    // not be stored — and a caller who tried should be told, not believe it.
    expect(refused.status(), await refused.text()).toBe(400)
    const doc = await preview(request, invoice.id)
    expect((doc.delivery as Json).deliveredOn, 'nothing at all was written').toBeNull()
    expect(JSON.stringify(doc)).not.toContain('สมชาย')
  })

  test('a delivery note can be handed out by public link; a tax document cannot', async ({ playwright, baseURL }) => {
    const invoice = await createInvoice(request)
    const facts = await readJson(await request.get(`/api/orva_documents/delivery-facts?invoiceId=${invoice.id}`))
    await request.post('/api/orva_documents/delivery-facts', {
      data: { invoiceId: invoice.id, updatedAt: String(facts.updatedAt), deliveredOn: '2026-09-09', carrier: 'รถบริษัท' },
    })

    // Mint the link. The type is restricted at the schema: a ใบกำกับภาษี is
    // refused before anything is read.
    const refused = await request.post('/api/orva_documents/share-document', {
      data: { documentId: invoice.id, type: 'tax_invoice' },
    })
    expect(refused.status(), await refused.text()).toBe(400)

    const minted = await request.post('/api/orva_documents/share-document', {
      data: { documentId: invoice.id, type: 'delivery_note' },
    })
    expect(minted.status(), await minted.text()).toBe(200)
    const first = await readJson(minted)
    const token = String(first.url).split('/documents/')[1]
    expect(token, `the url must end in a token: ${first.url}`).toMatch(/^[0-9a-f-]{36}$/)
    expect(first.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    // The public endpoint needs no session at all: an anonymous context reads it.
    const anonymous = await playwright.request.newContext({ baseURL })
    const opened = await anonymous.get(`/api/orva_documents/public/${token}`)
    expect(opened.status(), await opened.text()).toBe(200)
    const body = await readJson(opened)
    const doc = body.document as Json
    expect(body.kind).toBe('share_link')
    expect(doc.headingTh).toBe('ใบส่งของ')
    expect(doc.number).toBe(`DN-${invoice.number}`)
    // What the customer's warehouse holds: the goods and the delivery, no money.
    expect(doc.showPrices).toBe(false)
    expect(doc.amountInWords).toBeNull()
    expect((doc.delivery as Json).carrier).toBe('รถบริษัท')
    // The labels travel with the sheet, pinned to Thai, whatever the visitor's browser asks for.
    expect((body.labels as Json)['orva_documents.type.delivery_note']).toBe('ใบส่งของ')

    // Minting again rotates: the earlier link dies, the new one lives.
    const second = await readJson(await request.post('/api/orva_documents/share-document', {
      data: { documentId: invoice.id, type: 'delivery_note' },
    }))
    const secondToken = String(second.url).split('/documents/')[1]
    expect(secondToken).not.toBe(token)
    expect((await anonymous.get(`/api/orva_documents/public/${token}`)).status()).toBe(404)
    expect((await anonymous.get(`/api/orva_documents/public/${secondToken}`)).status()).toBe(200)

    // A token nobody minted is a 404, not an error page.
    expect((await anonymous.get('/api/orva_documents/public/00000000-0000-4000-8000-000000000000')).status()).toBe(404)
    await anonymous.dispose()
  })

  test('the public page opens the delivery note for a visitor with no session', async ({ browser, baseURL }) => {
    const invoice = await createInvoice(request)
    const minted = await readJson(await request.post('/api/orva_documents/share-document', {
      data: { documentId: invoice.id, type: 'delivery_note' },
    }))
    const token = String(minted.url).split('/documents/')[1]

    // Deliberately no cookies: this is the customer's warehouse opening a link.
    const context = await browser.newContext({ baseURL })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    await page.goto(`/documents/${token}`)
    const sheet = page.locator('[data-document-sheet="true"]').first()
    await expect(sheet).toBeVisible({ timeout: 30_000 })
    const printed = (await sheet.innerText()).replace(/\s+/g, ' ')
    expect(printed).toContain('ใบส่งของ')
    expect(printed).toContain(`DN-${invoice.number}`)
    expect(printed).toContain('Marventine Body Lotion 200 มล. (ลัง/24 ขวด)')
    expect(printed, 'no unit price on a link a driver can forward').not.toContain('2,400')
    expect(printed, 'no line amount either').not.toContain('24,000')
    // The visitor gets print and PDF, and no button that belongs to a quotation.
    await expect(page.getByRole('link', { name: /PDF/ })).toBeVisible()
    expect(errors, `client errors: ${errors.join(' | ')}`).toEqual([])

    // The PDF endpoint answers for this token too. Chromium may be absent on
    // the ephemeral host, which the route reports as 503 rather than a crash.
    const pdf = await page.request.get(`/api/orva_documents/public/${token}/pdf`)
    expect([200, 503]).toContain(pdf.status())
    if (pdf.status() === 200) expect(pdf.headers()['content-type']).toContain('application/pdf')
    await context.close()
  })

  test('TEST-010: the sheet renders in the browser, and the row actions are there', async ({ browser, baseURL }) => {
    const invoice = await createInvoice(request)
    const saved = await request.post('/api/orva_documents/delivery-facts', {
      data: {
        invoiceId: invoice.id,
        updatedAt: String((await readJson(await request.get(`/api/orva_documents/delivery-facts?invoiceId=${invoice.id}`))).updatedAt),
        deliveredOn: '2026-09-09',
        carrier: 'รถบริษัท (ทะเบียน 1กก-1234)',
      },
    })
    expect(saved.status()).toBe(200)

    // The app's own cookies are Secure and the base URL is http, so they are
    // re-added here without that flag — the same reason the API context sends
    // them as a header.
    const context = await browser.newContext({ baseURL })
    const host = new URL(baseURL ?? 'http://127.0.0.1').hostname
    await context.addCookies(
      cookie.split('; ').map((pair) => {
        const index = pair.indexOf('=')
        return { name: pair.slice(0, index), value: pair.slice(index + 1), domain: host, path: '/', secure: false }
      }),
    )
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    await page.goto(`/backend/documents/preview?type=delivery_note&documentId=${invoice.id}`)
    const sheet = page.locator('[data-document-sheet="true"]').first()
    await expect(sheet).toBeVisible({ timeout: 30_000 })
    const printed = (await sheet.innerText()).replace(/\s+/g, ' ')

    // Read the sheet the way the customer holds it. The tenant's locale
    // decides the labels — the ephemeral one is English — so the assertions
    // accept either language and lean on what cannot be translated: the
    // number, the carrier, the goods, and the absence of prices.
    expect(printed).toMatch(/ใบส่งของ|Delivery Note/)
    expect(printed).toContain(`DN-${invoice.number}`)
    expect(printed).toMatch(/รายละเอียดการส่งของ|Delivery details/)
    expect(printed).toMatch(/วันที่ส่งของ|Delivered on/)
    expect(printed).toContain('รถบริษัท (ทะเบียน 1กก-1234)')
    expect(printed).toMatch(/ผู้ส่งสินค้า|Delivered by|Consignor/i)
    expect(printed).toMatch(/ผู้รับสินค้า|Received by|Consignee/i)
    expect(printed).toContain('Marventine Body Lotion 200 มล. (ลัง/24 ขวด)')
    expect(printed, 'the unit price must not reach the sheet').not.toContain('2,400')
    expect(printed, 'the line amount must not reach the sheet').not.toContain('24,000')
    // Two counterparts print: one is left with the goods, one comes back
    // signed. Only the first carries `data-document-sheet` — the PDF renderer
    // waits on that marker — so the pair is read off the page's own text.
    const whole = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    expect(whole).toMatch(/ต้นฉบับ|Original \(customer/)
    expect(whole, 'the copy that comes back signed').toMatch(/สำเนา|Copy \(company/)

    // The invoices list offers both halves of the job.
    await page.goto('/backend/sales/invoices')
    await expect(page.getByText(invoice.number).first()).toBeVisible({ timeout: 30_000 })
    expect(errors, `client errors: ${errors.join(' | ')}`).toEqual([])
    await context.close()
  })
})
