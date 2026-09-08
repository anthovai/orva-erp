import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'

/**
 * The purchasing lifecycle, exercised through the real HTTP routes against the
 * ephemeral app and its own throwaway database.
 *
 * Written because phases A1 and A2 shipped with unit coverage of the pure
 * decisions and nothing that proved the routes, the guards, the row locks or
 * the internal call to `orva_stock` actually work end to end. The spec names
 * these as TEST-002 (lifecycle and freeze), TEST-003 (over-receipt),
 * TEST-005 (scope) and TEST-015 (short close).
 *
 * Credentials are the harness's own documented fixtures in an ephemeral
 * database (see om-prepare-test-env), never a real tenant's.
 */
const CREDENTIALS = { email: 'admin@acme.com', password: 'secret' }

type Json = Record<string, unknown>

/**
 * Signs in and returns a context that actually carries the session.
 *
 * The ephemeral app is a production build, so `auth_token` and
 * `session_token` are set with `Secure` — and a client will not send a Secure
 * cookie back over plain http, which is what the ephemeral base URL is. The
 * cookie jar therefore silently sends nothing and every authenticated call
 * answers 401. Reading the `set-cookie` values off the login response and
 * putting them on the request context as a header sidesteps the rule the way
 * an API client would, without weakening anything in the app.
 */
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

async function readJson(response: { json: () => Promise<unknown>; text: () => Promise<string> }): Promise<Json> {
  const body = await response.text()
  try {
    return JSON.parse(body) as Json
  } catch {
    throw new Error(`expected JSON, got: ${body.slice(0, 400)}`)
  }
}

/** A party holding the vendor role — purchasing refuses anything else. */
async function createVendor(request: APIRequestContext, name: string): Promise<string> {
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
 * across the specs in this file: purchasing only stores the id.
 */
async function ensureAccountId(request: APIRequestContext): Promise<string> {
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
async function ensurePeriodId(request: APIRequestContext): Promise<string> {
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

test.describe('purchase orders', () => {
  let request: APIRequestContext

  test.beforeAll(async ({ playwright, baseURL }) => {
    request = await authedContext(playwright, baseURL)
  })

  test.afterAll(async () => {
    await request?.dispose()
  })

  test('TEST-002: a draft is editable, sending numbers and freezes it', async () => {
    const vendorPartyId = await createVendor(request, `OEM Lifecycle ${Date.now()}`)
    const accountId = await ensureAccountId(request)

    const created = await request.post('/api/orva_purchasing/orders', {
      data: {
        vendorPartyId,
        orderDate: '2026-09-08',
        expectedOn: '2026-10-15',
        memo: 'integration: lifecycle',
        lines: [
          {
            kind: 'service',
            description: 'ค่าขนส่ง',
            quantity: 1,
            unitPrice: 1500,
            vatMode: 'none',
            accountId,
          },
        ],
      },
    })
    expect(created.status(), await created.text()).toBe(201)
    const orderId = String((await readJson(created)).id)

    // A draft carries no number.
    let detail = await readJson(await request.get(`/api/orva_purchasing/orders/${orderId}`))
    let order = detail.order as Json
    expect(order.status).toBe('draft')
    expect(order.poNumber).toBeNull()
    expect(order.totalAmount).toBe(1500)

    // Sending claims one and freezes the lines.
    const sent = await request.post(`/api/orva_purchasing/orders/${orderId}/send`, {
      data: { updatedAt: order.updatedAt },
    })
    expect(sent.status(), await sent.text()).toBe(200)
    const sentBody = await readJson(sent)
    expect(String(sentBody.poNumber)).toMatch(/^PO-\d{6}-\d{4}$/)
    expect(sentBody.status).toBe('sent')

    // Editing a line after that is refused, and says why.
    const frozen = await request.put('/api/orva_purchasing/orders', {
      data: {
        id: orderId,
        updatedAt: sentBody.updatedAt,
        lines: [
          { kind: 'service', description: 'ค่าขนส่ง', quantity: 2, unitPrice: 1500, vatMode: 'none', accountId },
        ],
      },
    })
    expect(frozen.status()).toBe(409)
    expect((await readJson(frozen)).code).toBe('frozen')

    // The memo is not part of the promise, so it still saves.
    detail = await readJson(await request.get(`/api/orva_purchasing/orders/${orderId}`))
    order = detail.order as Json
    const memoEdit = await request.put('/api/orva_purchasing/orders', {
      data: { id: orderId, updatedAt: order.updatedAt, memo: 'integration: memo after send' },
    })
    expect(memoEdit.status(), await memoEdit.text()).toBe(200)

    // A stale version is a conflict, not a silent overwrite.
    const stale = await request.put('/api/orva_purchasing/orders', {
      data: { id: orderId, updatedAt: order.updatedAt, memo: 'integration: stale' },
    })
    expect(stale.status()).toBe(409)
    expect((await readJson(stale)).code).toBe('conflict')
  })

  test('TEST-003 / TEST-015: a service line receives, over-receives, then short closes', async () => {
    const vendorPartyId = await createVendor(request, `OEM Receiving ${Date.now()}`)
    const accountId = await ensureAccountId(request)

    const created = await request.post('/api/orva_purchasing/orders', {
      data: {
        vendorPartyId,
        orderDate: '2026-09-08',
        lines: [
          { kind: 'service', description: 'ชั่วโมงที่ปรึกษา', quantity: 10, unitPrice: 1000, vatMode: '7', accountId },
        ],
      },
    })
    expect(created.status(), await created.text()).toBe(201)
    const orderId = String((await readJson(created)).id)

    let detail = await readJson(await request.get(`/api/orva_purchasing/orders/${orderId}`))
    let order = detail.order as Json
    let lines = detail.lines as Array<Json>
    const lineId = String(lines[0].id)

    // Receiving before the order is sent is refused.
    const early = await request.post(`/api/orva_purchasing/orders/${orderId}/receive`, {
      data: { updatedAt: order.updatedAt, receivedOn: '2026-09-08', lines: [{ lineId, quantity: 1 }] },
    })
    expect(early.status()).toBe(409)
    expect((await readJson(early)).code).toBe('invalid_transition')

    const sent = await readJson(
      await request.post(`/api/orva_purchasing/orders/${orderId}/send`, { data: { updatedAt: order.updatedAt } }),
    )

    // Eight of ten arrive.
    const partial = await request.post(`/api/orva_purchasing/orders/${orderId}/receive`, {
      data: { updatedAt: sent.updatedAt, receivedOn: '2026-09-09', lines: [{ lineId, quantity: 8 }] },
    })
    expect(partial.status(), await partial.text()).toBe(200)
    const partialBody = await readJson(partial)
    expect(partialBody.status).toBe('partially_received')

    detail = await readJson(await request.get(`/api/orva_purchasing/orders/${orderId}`))
    lines = detail.lines as Array<Json>
    expect(lines[0].receivedQty).toBe(8)
    expect(lines[0].remainingQty).toBe(2)
    expect((detail.receipts as Array<Json>).length).toBe(1)

    // Three more would exceed the order: refused, and nothing is written.
    order = detail.order as Json
    const over = await request.post(`/api/orva_purchasing/orders/${orderId}/receive`, {
      data: { updatedAt: order.updatedAt, receivedOn: '2026-09-10', lines: [{ lineId, quantity: 3 }] },
    })
    expect(over.status()).toBe(409)
    const overBody = await readJson(over)
    expect(overBody.code).toBe('over_receipt')
    expect(String(overBody.error)).toContain('2')

    detail = await readJson(await request.get(`/api/orva_purchasing/orders/${orderId}`))
    expect((detail.receipts as Array<Json>).length, 'a refused receipt writes nothing').toBe(1)
    expect((detail.lines as Array<Json>)[0].receivedQty).toBe(8)

    // Closing short records what never arrived and stops further receipts.
    order = detail.order as Json
    const closed = await request.post(`/api/orva_purchasing/orders/${orderId}/close`, {
      data: { updatedAt: order.updatedAt, reason: 'integration: vendor could not deliver the rest' },
    })
    expect(closed.status(), await closed.text()).toBe(200)
    const closedBody = await readJson(closed)
    expect(closedBody.status).toBe('closed')
    expect(closedBody.shortQty).toEqual([
      { lineNo: 1, description: 'ชั่วโมงที่ปรึกษา', shortQty: 2 },
    ])

    detail = await readJson(await request.get(`/api/orva_purchasing/orders/${orderId}`))
    order = detail.order as Json
    const afterClose = await request.post(`/api/orva_purchasing/orders/${orderId}/receive`, {
      data: { updatedAt: order.updatedAt, receivedOn: '2026-09-11', lines: [{ lineId, quantity: 1 }] },
    })
    expect(afterClose.status()).toBe(409)
    expect((await readJson(afterClose)).code).toBe('closed')
  })

  test('a raised quantity is the only line edit a sent order allows', async () => {
    const vendorPartyId = await createVendor(request, `OEM Adjust ${Date.now()}`)
    const accountId = await ensureAccountId(request)

    const created = await request.post('/api/orva_purchasing/orders', {
      data: {
        vendorPartyId,
        orderDate: '2026-09-08',
        lines: [{ kind: 'service', description: 'งานติดตั้ง', quantity: 5, unitPrice: 200, vatMode: 'none', accountId }],
      },
    })
    const orderId = String((await readJson(created)).id)
    let detail = await readJson(await request.get(`/api/orva_purchasing/orders/${orderId}`))
    let order = detail.order as Json
    const lineId = String((detail.lines as Array<Json>)[0].id)
    const sent = await readJson(
      await request.post(`/api/orva_purchasing/orders/${orderId}/send`, { data: { updatedAt: order.updatedAt } }),
    )

    // Down is refused.
    const down = await request.post(`/api/orva_purchasing/orders/${orderId}/lines/${lineId}/adjust-quantity`, {
      data: { updatedAt: sent.updatedAt, quantity: 4, reason: 'integration: should refuse' },
    })
    expect(down.status()).toBe(400)
    expect((await readJson(down)).code).toBe('not_an_increase')

    // Up is allowed, with a reason, and the total follows.
    const up = await request.post(`/api/orva_purchasing/orders/${orderId}/lines/${lineId}/adjust-quantity`, {
      data: { updatedAt: sent.updatedAt, quantity: 6, reason: 'integration: vendor over-delivered' },
    })
    expect(up.status(), await up.text()).toBe(200)

    detail = await readJson(await request.get(`/api/orva_purchasing/orders/${orderId}`))
    order = detail.order as Json
    expect((detail.lines as Array<Json>)[0].quantity).toBe(6)
    expect(order.totalAmount).toBe(1200)
    expect(String(order.memo)).toContain('integration: vendor over-delivered')
  })

  test('the ใบสั่งซื้อ sheet renders through the document rails', async () => {
    const vendorPartyId = await createVendor(request, `OEM Printing ${Date.now()}`)
    const accountId = await ensureAccountId(request)
    const created = await request.post('/api/orva_purchasing/orders', {
      data: {
        vendorPartyId,
        orderDate: '2026-09-08',
        lines: [{ kind: 'service', description: 'ค่าออกแบบ', quantity: 1, unitPrice: 5000, vatMode: '7', accountId }],
      },
    })
    const orderId = String((await readJson(created)).id)

    const preview = await request.get(
      `/api/orva_documents/preview?type=purchase_order&documentId=${orderId}`,
    )
    expect(preview.status(), await preview.text()).toBe(200)
    const body = await readJson(preview)
    expect(body.sourceKind).toBe('purchase_order')
    const document = body.document as Json
    expect(document.headingTh).toBe('ใบสั่งซื้อ')
    // We issue it, so the counterparty block is labelled ผู้ขาย, not ลูกค้า.
    expect((document.partyTitles as Json).counterpartyTh).toBe('ผู้ขาย')
    expect(document.isTaxDocument).toBe(false)
    expect(document.grandTotal).toBe(5350)
  })

  test('TEST-005: purchasing refuses a party that does not hold the vendor role', async () => {
    const accountId = await ensureAccountId(request)
    const created = await request.post('/api/orva_party/parties', {
      data: { kind: 'company', displayName: `Not A Vendor ${Date.now()}` },
    })
    const party = await readJson(created)
    const partyId = String(party.id ?? (party as { item?: { id?: string } }).item?.id ?? '')

    const refused = await request.post('/api/orva_purchasing/orders', {
      data: {
        vendorPartyId: partyId,
        orderDate: '2026-09-08',
        lines: [{ kind: 'service', description: 'x', quantity: 1, unitPrice: 1, vatMode: 'none', accountId }],
      },
    })
    expect(refused.status()).toBe(400)
    expect((await readJson(refused)).code).toBe('not_a_vendor')
  })

  test('a goods line cannot be ordered without a catalog product', async () => {
    const vendorPartyId = await createVendor(request, `OEM Goods ${Date.now()}`)
    const accountId = await ensureAccountId(request)
    const refused = await request.post('/api/orva_purchasing/orders', {
      data: {
        vendorPartyId,
        orderDate: '2026-09-08',
        lines: [{ kind: 'goods', description: 'ของที่ไม่มีในแค็ตตาล็อก', quantity: 1, unitPrice: 10, vatMode: '7', accountId }],
      },
    })
    expect(refused.status()).toBe(400)
  })
  test('TEST-004: a bill finance created is linked to the order, and the variance shows', async () => {
    const vendorPartyId = await createVendor(request, `OEM Billing ${Date.now()}`)
    const accountId = await ensureAccountId(request)
    const periodId = await ensurePeriodId(request)

    const created = await request.post('/api/orva_purchasing/orders', {
      data: {
        vendorPartyId,
        orderDate: '2026-09-08',
        lines: [
          { kind: 'service', description: 'งานพัฒนา', quantity: 1, unitPrice: 42500, vatMode: '7', accountId },
          { kind: 'service', description: 'ค่าขนส่ง', quantity: 1, unitPrice: 1500, vatMode: 'none', accountId },
        ],
      },
    })
    const orderId = String((await readJson(created)).id)
    let detail = await readJson(await request.get(`/api/orva_purchasing/orders/${orderId}`))
    let order = detail.order as Json
    const lines = detail.lines as Array<Json>
    await request.post(`/api/orva_purchasing/orders/${orderId}/send`, { data: { updatedAt: order.updatedAt } })

    // The prefill offers the whole order, because nothing is billed yet.
    const draft = await readJson(await request.get(`/api/orva_purchasing/orders/${orderId}/bill-draft`))
    expect((draft.lines as Array<Json>).length).toBe(2)
    expect((draft.lines as Array<Json>)[0].amount).toBe(42500)
    // Only the 7% line carries VAT: 42,500 x 7%.
    expect(draft.taxAmount).toBe(2975)

    // Finance creates the bill — purchasing never does.
    const bill = await request.post('/api/orva_finance/ap/bills', {
      data: {
        vendorPartyId,
        periodId,
        billDate: '2026-09-20',
        currencyCode: 'THB',
        taxAmount: 2975,
        lines: [
          { expenseAccountId: accountId, amount: 42500, description: 'งานพัฒนา' },
          // The vendor charged more freight than was ordered: 1,800 vs 1,500.
          { expenseAccountId: accountId, amount: 1800, description: 'ค่าขนส่ง' },
        ],
      },
    })
    expect(bill.status(), await bill.text()).toBeLessThan(300)
    const billId = String((await readJson(bill)).id ?? '')
    expect(billId).not.toBe('')

    detail = await readJson(await request.get(`/api/orva_purchasing/orders/${orderId}`))
    order = detail.order as Json
    const linked = await request.post(`/api/orva_purchasing/orders/${orderId}/bill`, {
      data: {
        updatedAt: order.updatedAt,
        billId,
        allocations: [
          { lineId: lines[0].id, billLineNo: 1, amount: 42500 },
          { lineId: lines[1].id, billLineNo: 2, amount: 1800 },
        ],
      },
    })
    expect(linked.status(), await linked.text()).toBe(200)
    expect(await readJson(linked)).toMatchObject({ ok: true, linked: 2, alreadyLinked: 0 })

    // The third number of the match is now real, and so is the variance.
    detail = await readJson(await request.get(`/api/orva_purchasing/orders/${orderId}`))
    const billedLines = detail.lines as Array<Json>
    expect(billedLines[0].billedAmount).toBe(42500)
    expect(billedLines[0].variance).toBe(0)
    expect(billedLines[1].billedAmount).toBe(1800)
    // Over-billed by 300: shown, never blocked (spec A3, owner-confirmed).
    expect(billedLines[1].variance).toBe(300)
    expect((detail.order as Json).billedAmount).toBe(44300)

    // A second bill is offered nothing, because the order is fully billed.
    const secondDraft = await readJson(await request.get(`/api/orva_purchasing/orders/${orderId}/bill-draft`))
    expect((secondDraft.lines as Array<Json>).length).toBe(0)
  })

  test('TEST-013: linking is idempotent, and a bill line cannot answer two orders', async () => {
    const vendorPartyId = await createVendor(request, `OEM Relink ${Date.now()}`)
    const accountId = await ensureAccountId(request)
    const periodId = await ensurePeriodId(request)

    const makeOrder = async () => {
      const created = await request.post('/api/orva_purchasing/orders', {
        data: {
          vendorPartyId,
          orderDate: '2026-09-08',
          lines: [{ kind: 'service', description: 'งานที่ปรึกษา', quantity: 1, unitPrice: 5000, vatMode: 'none', accountId }],
        },
      })
      const id = String((await readJson(created)).id)
      const detail = await readJson(await request.get(`/api/orva_purchasing/orders/${id}`))
      await request.post(`/api/orva_purchasing/orders/${id}/send`, {
        data: { updatedAt: (detail.order as Json).updatedAt },
      })
      const after = await readJson(await request.get(`/api/orva_purchasing/orders/${id}`))
      return { id, lineId: String((after.lines as Array<Json>)[0].id), updatedAt: (after.order as Json).updatedAt }
    }

    const first = await makeOrder()
    const second = await makeOrder()

    const bill = await request.post('/api/orva_finance/ap/bills', {
      data: {
        vendorPartyId,
        periodId,
        billDate: '2026-09-21',
        currencyCode: 'THB',
        lines: [{ expenseAccountId: accountId, amount: 5000, description: 'งานที่ปรึกษา' }],
      },
    })
    const billId = String((await readJson(bill)).id ?? '')

    // The bill is unlinked, so the recovery list offers it.
    const unlinked = await readJson(await request.get(`/api/orva_purchasing/orders/${first.id}/unlinked-bills`))
    expect((unlinked.bills as Array<Json>).some((row) => row.id === billId)).toBe(true)

    const allocation = { lineId: first.lineId, billLineNo: 1, amount: 5000 }
    const once = await request.post(`/api/orva_purchasing/orders/${first.id}/bill`, {
      data: { updatedAt: first.updatedAt, billId, allocations: [allocation] },
    })
    expect(once.status(), await once.text()).toBe(200)
    expect((await readJson(once)).linked).toBe(1)

    // The retry a client makes after losing the response writes nothing.
    const refreshed = await readJson(await request.get(`/api/orva_purchasing/orders/${first.id}`))
    const again = await request.post(`/api/orva_purchasing/orders/${first.id}/bill`, {
      data: { updatedAt: (refreshed.order as Json).updatedAt, billId, allocations: [allocation] },
    })
    expect(again.status(), await again.text()).toBe(200)
    expect(await readJson(again)).toMatchObject({ linked: 0, alreadyLinked: 1 })

    // And the same charge cannot be claimed by a second order.
    const stolen = await request.post(`/api/orva_purchasing/orders/${second.id}/bill`, {
      data: { updatedAt: second.updatedAt, billId, allocations: [{ lineId: second.lineId, billLineNo: 1, amount: 5000 }] },
    })
    expect(stolen.status()).toBe(409)
    expect((await readJson(stolen)).code).toBe('already_linked')

    // It is also gone from the recovery list now.
    const after = await readJson(await request.get(`/api/orva_purchasing/orders/${first.id}/unlinked-bills`))
    expect((after.bills as Array<Json>).some((row) => row.id === billId)).toBe(false)
  })

  test('a bill from another vendor, and one above the bill line, are both refused', async () => {
    const vendorPartyId = await createVendor(request, `OEM Guard ${Date.now()}`)
    const otherVendorId = await createVendor(request, `Other Vendor ${Date.now()}`)
    const accountId = await ensureAccountId(request)
    const periodId = await ensurePeriodId(request)

    const created = await request.post('/api/orva_purchasing/orders', {
      data: {
        vendorPartyId,
        orderDate: '2026-09-08',
        lines: [{ kind: 'service', description: 'งาน', quantity: 1, unitPrice: 1000, vatMode: 'none', accountId }],
      },
    })
    const orderId = String((await readJson(created)).id)
    let detail = await readJson(await request.get(`/api/orva_purchasing/orders/${orderId}`))
    const lineId = String((detail.lines as Array<Json>)[0].id)
    await request.post(`/api/orva_purchasing/orders/${orderId}/send`, {
      data: { updatedAt: (detail.order as Json).updatedAt },
    })

    const foreignBill = await request.post('/api/orva_finance/ap/bills', {
      data: {
        vendorPartyId: otherVendorId,
        periodId,
        billDate: '2026-09-22',
        currencyCode: 'THB',
        lines: [{ expenseAccountId: accountId, amount: 1000, description: 'งาน' }],
      },
    })
    const foreignBillId = String((await readJson(foreignBill)).id ?? '')

    detail = await readJson(await request.get(`/api/orva_purchasing/orders/${orderId}`))
    const wrongVendor = await request.post(`/api/orva_purchasing/orders/${orderId}/bill`, {
      data: {
        updatedAt: (detail.order as Json).updatedAt,
        billId: foreignBillId,
        allocations: [{ lineId, billLineNo: 1, amount: 1000 }],
      },
    })
    expect(wrongVendor.status()).toBe(400)
    expect((await readJson(wrongVendor)).code).toBe('vendor_mismatch')

    const ownBill = await request.post('/api/orva_finance/ap/bills', {
      data: {
        vendorPartyId,
        periodId,
        billDate: '2026-09-22',
        currencyCode: 'THB',
        lines: [{ expenseAccountId: accountId, amount: 1000, description: 'งาน' }],
      },
    })
    const ownBillId = String((await readJson(ownBill)).id ?? '')
    detail = await readJson(await request.get(`/api/orva_purchasing/orders/${orderId}`))
    const tooMuch = await request.post(`/api/orva_purchasing/orders/${orderId}/bill`, {
      data: {
        updatedAt: (detail.order as Json).updatedAt,
        billId: ownBillId,
        allocations: [{ lineId, billLineNo: 1, amount: 1500 }],
      },
    })
    expect(tooMuch.status()).toBe(400)
    expect((await readJson(tooMuch)).code).toBe('amount_exceeds_bill_line')
  })

  test('a draft order offers no bill prefill', async () => {
    const vendorPartyId = await createVendor(request, `OEM Draft Bill ${Date.now()}`)
    const accountId = await ensureAccountId(request)
    const created = await request.post('/api/orva_purchasing/orders', {
      data: {
        vendorPartyId,
        orderDate: '2026-09-08',
        lines: [{ kind: 'service', description: 'งาน', quantity: 1, unitPrice: 100, vatMode: 'none', accountId }],
      },
    })
    const orderId = String((await readJson(created)).id)
    const draft = await request.get(`/api/orva_purchasing/orders/${orderId}/bill-draft`)
    expect(draft.status()).toBe(409)
    expect((await readJson(draft)).code).toBe('invalid_transition')
  })
  test('TEST-006: a late line and the committed figure reach the home screen', async () => {
    const vendorPartyId = await createVendor(request, `OEM Late ${Date.now()}`)
    const accountId = await ensureAccountId(request)
    const periodId = await ensurePeriodId(request)
    // Ordered to arrive a fortnight ago and never did.
    const expectedOn = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10)

    const created = await request.post('/api/orva_purchasing/orders', {
      data: {
        vendorPartyId,
        orderDate: '2026-09-01',
        expectedOn,
        lines: [
          { kind: 'service', description: 'ของที่รอมานาน', quantity: 10, unitPrice: 700, vatMode: 'none', accountId, expectedOn },
        ],
      },
    })
    const orderId = String((await readJson(created)).id)
    let detail = await readJson(await request.get(`/api/orva_purchasing/orders/${orderId}`))
    const lineId = String((detail.lines as Array<Json>)[0].id)

    // A draft is nobody's problem yet: it promises nothing.
    let summary = await readJson(await request.get('/api/orva_purchasing/summary'))
    const draftLate = (summary.lateLines as Array<Json>).filter((row) => row.orderId === orderId)
    expect(draftLate.length, 'a draft order is not late, it is unsent').toBe(0)

    await request.post(`/api/orva_purchasing/orders/${orderId}/send`, {
      data: { updatedAt: (detail.order as Json).updatedAt },
    })

    // Sent and overdue: it is late, and it counts as committed money.
    summary = await readJson(await request.get('/api/orva_purchasing/summary'))
    const late = (summary.lateLines as Array<Json>).find((row) => row.lineId === lineId)
    expect(late, 'the overdue line must appear in the summary').toBeTruthy()
    expect(Number(late!.daysLate)).toBeGreaterThanOrEqual(13)
    expect(Number(late!.remainingQty)).toBe(10)
    const committedWithOrder = Number(summary.committedNotBilled)
    expect(committedWithOrder).toBeGreaterThanOrEqual(7000)

    // And the owner sees both without opening purchasing at all.
    const overview = await readJson(await request.get('/api/orva_finance/home/overview'))
    const waiting = overview.waiting as Json
    expect(
      (waiting.latePurchaseLines as Array<Json>).some((row) => row.orderId === orderId),
      'the home waiting card reads purchasing through optional DI',
    ).toBe(true)
    expect(Number(waiting.committedNotBilled)).toBeGreaterThanOrEqual(7000)

    // Billing it removes it from the committed figure: the bill has arrived,
    // so the money is no longer merely promised.
    const bill = await request.post('/api/orva_finance/ap/bills', {
      data: {
        vendorPartyId,
        periodId,
        billDate: '2026-09-25',
        currencyCode: 'THB',
        lines: [{ expenseAccountId: accountId, amount: 7000, description: 'ของที่รอมานาน' }],
      },
    })
    const billId = String((await readJson(bill)).id ?? '')
    detail = await readJson(await request.get(`/api/orva_purchasing/orders/${orderId}`))
    const linked = await request.post(`/api/orva_purchasing/orders/${orderId}/bill`, {
      data: {
        updatedAt: (detail.order as Json).updatedAt,
        billId,
        allocations: [{ lineId, billLineNo: 1, amount: 7000 }],
      },
    })
    expect(linked.status(), await linked.text()).toBe(200)

    summary = await readJson(await request.get('/api/orva_purchasing/summary'))
    expect(Number(summary.committedNotBilled)).toBeLessThanOrEqual(committedWithOrder - 7000)
    // Billed but still not delivered, so it stays late — the two are separate
    // facts and the card must not conflate them.
    expect((summary.lateLines as Array<Json>).some((row) => row.lineId === lineId)).toBe(true)

    // Closing it stops the chase entirely.
    detail = await readJson(await request.get(`/api/orva_purchasing/orders/${orderId}`))
    const closed = await request.post(`/api/orva_purchasing/orders/${orderId}/close`, {
      data: { updatedAt: (detail.order as Json).updatedAt, reason: 'integration: never arriving' },
    })
    expect(closed.status(), await closed.text()).toBe(200)

    summary = await readJson(await request.get('/api/orva_purchasing/summary'))
    expect((summary.lateLines as Array<Json>).some((row) => row.lineId === lineId)).toBe(false)
  })

  test('a line received in full is not late, however overdue its date', async () => {
    const vendorPartyId = await createVendor(request, `OEM OnTime ${Date.now()}`)
    const accountId = await ensureAccountId(request)
    const expectedOn = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10)

    const created = await request.post('/api/orva_purchasing/orders', {
      data: {
        vendorPartyId,
        orderDate: '2026-09-01',
        lines: [{ kind: 'service', description: 'มาแล้วครบ', quantity: 4, unitPrice: 100, vatMode: 'none', accountId, expectedOn }],
      },
    })
    const orderId = String((await readJson(created)).id)
    let detail = await readJson(await request.get(`/api/orva_purchasing/orders/${orderId}`))
    const lineId = String((detail.lines as Array<Json>)[0].id)
    const sent = await readJson(
      await request.post(`/api/orva_purchasing/orders/${orderId}/send`, {
        data: { updatedAt: (detail.order as Json).updatedAt },
      }),
    )

    // Late until it arrives…
    let summary = await readJson(await request.get('/api/orva_purchasing/summary'))
    expect((summary.lateLines as Array<Json>).some((row) => row.lineId === lineId)).toBe(true)

    await request.post(`/api/orva_purchasing/orders/${orderId}/receive`, {
      data: { updatedAt: sent.updatedAt, receivedOn: '2026-09-28', lines: [{ lineId, quantity: 4 }] },
    })

    // …and not late once it has, because the receipts decide, not the date.
    summary = await readJson(await request.get('/api/orva_purchasing/summary'))
    expect((summary.lateLines as Array<Json>).some((row) => row.lineId === lineId)).toBe(false)
    detail = await readJson(await request.get(`/api/orva_purchasing/orders/${orderId}`))
    expect((detail.order as Json).status).toBe('received')
  })
})
