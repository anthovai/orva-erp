import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { createVendor, ensureAccountId, ensurePeriodId, login, readJson, signedInBrowser, type Json } from './fixtures'

/**
 * TEST-010 — the purchasing screens, walked in a browser.
 *
 * Phases A1–A4 shipped with API coverage only, and the spec said so every
 * time: nobody had opened the list, the detail, the receive dialog or the
 * create form. These walk them with a real session against the production
 * build, in Thai, because the tenant is Thai and the operator reads Thai
 * labels — asserting the English catalogue would be walking a screen nobody
 * uses.
 *
 * Every test fails on a client-side error, which is the point: a screen that
 * renders while throwing in the console is not working.
 */

type Fixture = {
  vendorPartyId: string
  vendorName: string
  accountId: string
  draftId: string
  sentId: string
  sentNumber: string
}

/** An order of one service line, sent, so it has a number and is frozen. */
async function sentOrder(
  request: APIRequestContext,
  args: { vendorPartyId: string; accountId: string; description: string; quantity: number; unitPrice: number; expectedOn?: string },
): Promise<{ id: string; number: string }> {
  const created = await request.post('/api/orva_purchasing/orders', {
    data: {
      vendorPartyId: args.vendorPartyId,
      orderDate: '2026-09-01',
      ...(args.expectedOn ? { expectedOn: args.expectedOn } : {}),
      lines: [
        {
          kind: 'service',
          description: args.description,
          quantity: args.quantity,
          unitPrice: args.unitPrice,
          vatMode: 'none',
          accountId: args.accountId,
          ...(args.expectedOn ? { expectedOn: args.expectedOn } : {}),
        },
      ],
    },
  })
  expect(created.status(), await created.text()).toBeLessThan(300)
  const id = String((await readJson(created)).id)
  const detail = await readJson(await request.get(`/api/orva_purchasing/orders/${id}`))
  const sending = await request.post(`/api/orva_purchasing/orders/${id}/send`, {
    data: { updatedAt: (detail.order as Json).updatedAt },
  })
  expect(sending.status(), await sending.text()).toBe(200)
  const number = String((await readJson(sending)).poNumber ?? '')
  expect(number, 'sending must claim a PO number').not.toBe('')
  return { id, number }
}

/** A draft and a sent-but-overdue order, so the list has something to say. */
async function seed(request: APIRequestContext): Promise<Fixture> {
  const vendorName = `OEM Screens ${Date.now()}`
  const vendorPartyId = await createVendor(request, vendorName)
  const accountId = await ensureAccountId(request)
  const overdue = new Date(Date.now() - 9 * 86_400_000).toISOString().slice(0, 10)

  const draft = await request.post('/api/orva_purchasing/orders', {
    data: {
      vendorPartyId,
      orderDate: '2026-09-01',
      memo: 'ฉบับร่างสำหรับเดินหน้าจอ',
      lines: [{ kind: 'service', description: 'ค่าออกแบบกล่อง', quantity: 2, unitPrice: 1500, vatMode: '7', accountId }],
    },
  })
  expect(draft.status(), await draft.text()).toBeLessThan(300)
  const draftId = String((await readJson(draft)).id)

  // Sent and nine days overdue, so the list has something to call late.
  const sent = await sentOrder(request, {
    vendorPartyId, accountId, description: 'ค่าขนส่งล็อตกันยายน', quantity: 10, unitPrice: 700, expectedOn: overdue,
  })

  return { vendorPartyId, vendorName, accountId, draftId, sentId: sent.id, sentNumber: sent.number }
}

/** Collects anything the page throws or logs as an error while we walk it. */
function watch(page: Page): string[] {
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    // A 409 or a 404 answered on purpose by a test below is logged by the
    // fetch layer; only unexpected errors matter here.
    if (/Failed to load resource|status of 40[49]/i.test(text)) return
    problems.push(`console: ${text}`)
  })
  return problems
}

test.describe('purchasing screens (TEST-010)', () => {
  let request: APIRequestContext
  let cookie: string
  let fixture: Fixture

  test.beforeAll(async ({ playwright, baseURL }) => {
    const session = await login(playwright, baseURL)
    request = session.request
    cookie = session.cookie
    fixture = await seed(request)
  })

  test.afterAll(async () => { await request?.dispose() })

  test('the list names what is late and what is committed, and the filter narrows to it', async ({ browser, baseURL }) => {
    const context = await signedInBrowser(browser, baseURL, cookie)
    const page = await context.newPage()
    const problems = watch(page)

    await page.goto('/backend/purchasing/orders')
    await expect(page.getByRole('heading', { name: 'ใบสั่งซื้อ' }).first()).toBeVisible({ timeout: 30_000 })

    // Both orders are here, the draft without a number.
    const body = () => page.locator('body').innerText()
    await expect(page.getByText(fixture.sentNumber).first()).toBeVisible({ timeout: 15_000 })
    const listed = (await body()).replace(/\s+/g, ' ')
    expect(listed, 'a draft has no number yet, and the list says so').toContain('ฉบับร่าง')
    // The overdue line is counted on the row, not hidden behind a report.
    expect(listed).toMatch(/เกินกำหนด \d+ รายการ/)
    // …and the money already promised is on the header.
    expect(listed).toContain('ผูกพันแล้ว')

    // The late filter is a button. It must narrow the list and leave only
    // rows that really are late — counting rows rather than looking for the
    // draft's absence, because the other specs in this run leave drafts too.
    const rows = page.getByRole('row')
    const before = await rows.count()
    expect(before, 'the list must have rows to narrow').toBeGreaterThan(1)
    await page.getByRole('button', { name: /เฉพาะที่เกินกำหนด/ }).click()
    // The table swaps in a loading row while it refetches; reading the rows
    // before that settles reads "กำลังโหลดตาราง…" instead of the data.
    await expect
      .poll(
        async () => {
          const texts = (await rows.allInnerTexts()).slice(1).filter((text) => text.trim().length > 0)
          return texts.length > 0 && texts.every((text) => !text.includes('กำลังโหลด'))
        },
        { timeout: 20_000 },
      )
      .toBe(true)
    expect(await rows.count(), 'the filter must narrow the list').toBeLessThan(before)
    const remaining = (await rows.allInnerTexts()).slice(1).filter((text) => text.trim().length > 0)
    expect(remaining.length, 'the late order itself must survive the filter').toBeGreaterThan(0)
    for (const row of remaining) expect(row, 'every row left is actually late').toMatch(/เกินกำหนด/)
    expect((await body())).toContain(fixture.sentNumber)

    expect(problems, problems.join(' | ')).toEqual([])
    await context.close()
  })

  test('a draft offers send and delete; a sent order offers receive, bill and close', async ({ browser, baseURL }) => {
    const context = await signedInBrowser(browser, baseURL, cookie)
    const page = await context.newPage()
    const problems = watch(page)

    await page.goto(`/backend/purchasing/orders/${fixture.draftId}`)
    await expect(page.getByRole('button', { name: 'ส่งให้ผู้ขาย' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'ลบฉบับร่าง' })).toBeVisible()
    // Nothing can arrive against an order the vendor has never seen.
    await expect(page.getByRole('button', { name: 'รับของ' })).toHaveCount(0)
    // A draft opens as its own edit form — the one status where the lines are
    // editable in place — so the description is an input value, not page text.
    // (`input[value=…]` would match the attribute, which React does not keep
    // in step with a controlled input's live value.)
    await expect(page.getByPlaceholder(/ค่าขนส่ง, ค่าออกแบบ/)).toHaveValue('ค่าออกแบบกล่อง')

    await page.goto(`/backend/purchasing/orders/${fixture.sentId}`)
    await expect(page.getByRole('button', { name: 'รับของ' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'ปิดใบสั่งซื้อ' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'ผูกบิลที่มีอยู่' })).toBeVisible()
    // A sent order is frozen: it cannot be sent again or deleted.
    await expect(page.getByRole('button', { name: 'ส่งให้ผู้ขาย' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'ลบฉบับร่าง' })).toHaveCount(0)
    // The print/email rail is on both.
    await expect(page.getByRole('link', { name: /พิมพ์/ })).toBeVisible()

    expect(problems, problems.join(' | ')).toEqual([])
    await context.close()
  })

  test('the receive dialog refuses an over-receipt in place, and Esc closes it', async ({ browser, baseURL }) => {
    const context = await signedInBrowser(browser, baseURL, cookie)
    const page = await context.newPage()
    const problems = watch(page)

    await page.goto(`/backend/purchasing/orders/${fixture.sentId}`)
    await page.getByRole('button', { name: 'รับของ' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(dialog.getByText(/รับของเข้าคลัง/)).toBeVisible()

    // 10 were ordered. Asking for 12 must be refused on the screen, before
    // any request is made — the 409 the route would answer is a backstop.
    const quantity = dialog.locator('input[type="number"]').first()
    await quantity.fill('12')
    await expect(dialog.getByText(/รับเกินจำนวนที่เหลือ/)).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'บันทึกการรับของ' })).toBeDisabled()

    // Correct it and the button comes back.
    await quantity.fill('4')
    await expect(dialog.getByText(/รับเกินจำนวนที่เหลือ/)).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'บันทึกการรับของ' })).toBeEnabled()

    // Esc leaves without recording anything.
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden({ timeout: 10_000 })
    const after = await readJson(await request.get(`/api/orva_purchasing/orders/${fixture.sentId}`))
    expect((after.order as Json).status, 'Esc must not receive anything').toBe('sent')

    expect(problems, problems.join(' | ')).toEqual([])
    await context.close()
  })

  test('receiving from the dialog moves the order, and the detail shows the receipt', async ({ browser, baseURL }) => {
    const context = await signedInBrowser(browser, baseURL, cookie)
    const page = await context.newPage()
    const problems = watch(page)

    await page.goto(`/backend/purchasing/orders/${fixture.sentId}`)
    await page.getByRole('button', { name: 'รับของ' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await dialog.locator('input[type="number"]').first().fill('4')
    await dialog.getByRole('button', { name: 'บันทึกการรับของ' }).click()
    await expect(dialog).toBeHidden({ timeout: 20_000 })

    // The screen tells the truth about what arrived…
    await expect(page.getByText('รับของบางส่วน').first()).toBeVisible({ timeout: 20_000 })
    // …and so does the record.
    const after = await readJson(await request.get(`/api/orva_purchasing/orders/${fixture.sentId}`))
    expect((after.order as Json).status).toBe('partially_received')
    expect(Number((after.lines as Array<Json>)[0].receivedQty)).toBe(4)

    expect(problems, problems.join(' | ')).toEqual([])
    await context.close()
  })

  test('the create form makes a draft, and refuses to save one with nothing on it', async ({ browser, baseURL }) => {
    // The longest walk in the file: two page loads, three fetched option
    // lists, a line editor and a save. The suite's 20s default is for a
    // single screen.
    test.setTimeout(90_000)
    const context = await signedInBrowser(browser, baseURL, cookie)
    const page = await context.newPage()
    const problems = watch(page)

    await page.goto('/backend/purchasing/orders/create')
    await expect(page.getByRole('heading', { name: 'สร้างใบสั่งซื้อ' }).first()).toBeVisible({ timeout: 30_000 })
    // The form says what a draft costs: nothing, until it is sent.
    await expect(page.getByText(/ฉบับร่างยังไม่กินเลขที่/)).toBeVisible()

    // An empty form must complain rather than post an unusable order.
    await page.getByRole('button', { name: 'สร้างฉบับร่าง' }).click()
    await expect(page.getByText(/เลือกผู้ขายก่อน|ใส่รายการอย่างน้อยหนึ่งบรรทัด/).first()).toBeVisible({ timeout: 15_000 })

    // Now fill it in the order the screen asks for.
    const vendorSelect = page.locator('select').filter({ hasText: 'เลือกผู้ขาย' })
    // The vendor list is fetched: parties holding the vendor role, then their
    // names. Waiting for the name to appear waits for both queries.
    await expect(vendorSelect).toContainText(fixture.vendorName, { timeout: 20_000 })
    await vendorSelect.selectOption({ label: fixture.vendorName })
    // The form seeds itself with one goods row once settings load. Goods need
    // a catalog variant and this tenant has no catalog, so the service line is
    // added first and the goods row removed after — in that order, because the
    // seeding effect re-adds a goods row whenever the editor is left empty, so
    // removing the only line puts one straight back.
    await page.getByRole('button', { name: 'เพิ่มบริการ' }).click()
    await page.getByRole('button', { name: 'ลบบรรทัด' }).first().click()
    await page.getByPlaceholder(/ค่าขนส่ง, ค่าออกแบบ/).fill('ค่าติดตั้งชั้นวางในคลัง')
    const numbers = page.locator('input[type="number"]')
    await expect(numbers, 'one line means one quantity and one price').toHaveCount(2)
    await numbers.nth(0).fill('3')
    await numbers.nth(1).fill('2500')
    const accountSelect = page.locator('select').filter({ hasText: 'เลือกบัญชี' })
    await accountSelect.selectOption({ index: 1 })

    // The totals add up on screen before anything is saved: 3 × 2,500 = 7,500.
    await expect(page.getByText('7,500.00').first()).toBeVisible()

    await page.getByRole('button', { name: 'สร้างฉบับร่าง' }).click()
    // It lands on the new order's own page — which for a draft is the edit
    // form again, so the description is an input value and not page text.
    await expect(page.getByRole('button', { name: 'ส่งให้ผู้ขาย' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByPlaceholder(/ค่าขนส่ง, ค่าออกแบบ/)).toHaveValue('ค่าติดตั้งชั้นวางในคลัง')
    expect(page.url()).toMatch(/\/backend\/purchasing\/orders\/[0-9a-f-]{36}/)

    expect(problems, problems.join(' | ')).toEqual([])
    await context.close()
  })

  test('the settings page states the next number before it is claimed', async ({ browser, baseURL }) => {
    const context = await signedInBrowser(browser, baseURL, cookie)
    const page = await context.newPage()
    const problems = watch(page)

    await page.goto('/backend/settings/purchasing')
    await expect(page.getByRole('heading', { name: 'ตั้งค่าจัดซื้อ' }).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/ใบถัดไปจะได้เลขที่/)).toBeVisible()
    // The preview is a real number from the same formatter the send route uses.
    expect((await page.locator('body').innerText())).toMatch(/PO-\d{6}-\d{4}/)

    expect(problems, problems.join(' | ')).toEqual([])
    await context.close()
  })

  test('raising a quantity is allowed; lowering one is refused before any request', async ({ browser, baseURL }) => {
    const context = await signedInBrowser(browser, baseURL, cookie)
    const page = await context.newPage()
    const problems = watch(page)

    await page.goto(`/backend/purchasing/orders/${fixture.sentId}`)
    await page.getByRole('button', { name: 'เพิ่มจำนวน' }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(dialog.getByText('เพิ่มจำนวนที่สั่ง')).toBeVisible()
    // The dialog states what it is for: more arrived than was ordered. Less
    // is a short close, not an edit, and the hint says so.
    await expect(dialog.getByText(/เพิ่มได้เท่านั้น/)).toBeVisible()

    const quantity = dialog.locator('input[type="number"]')
    const reason = dialog.locator('input:not([type="number"])').last()
    await reason.fill('ผู้ขายส่งมาเกิน')
    // 10 were ordered. 8 is a reduction and the button will not have it.
    await quantity.fill('8')
    await expect(dialog.getByRole('button', { name: 'เพิ่มจำนวน' })).toBeDisabled()
    // The same number is not an increase either.
    await quantity.fill('10')
    await expect(dialog.getByRole('button', { name: 'เพิ่มจำนวน' })).toBeDisabled()
    await quantity.fill('12')
    await expect(dialog.getByRole('button', { name: 'เพิ่มจำนวน' })).toBeEnabled()
    await dialog.getByRole('button', { name: 'เพิ่มจำนวน' }).click()
    await expect(dialog).toBeHidden({ timeout: 15_000 })

    const after = await readJson(await request.get(`/api/orva_purchasing/orders/${fixture.sentId}`))
    expect(Number((after.lines as Array<Json>)[0].quantity)).toBe(12)

    expect(problems, problems.join(' | ')).toEqual([])
    await context.close()
  })

  test("the link-bill dialog offers the vendor's unlinked bill, and the detail shows what was billed", async ({ browser, baseURL }) => {
    test.setTimeout(60_000)
    // A fresh order and a bill finance raised for the same vendor and amount.
    const order = await sentOrder(request, {
      vendorPartyId: fixture.vendorPartyId, accountId: fixture.accountId, description: 'ค่าพิมพ์ฉลากล็อต 9', quantity: 10, unitPrice: 700,
    })
    const periodId = await ensurePeriodId(request)
    const bill = await request.post('/api/orva_finance/ap/bills', {
      data: {
        vendorPartyId: fixture.vendorPartyId,
        periodId,
        billDate: '2026-09-25',
        currencyCode: 'THB',
        lines: [{ expenseAccountId: fixture.accountId, amount: 7000, description: 'ค่าพิมพ์ฉลากล็อต 9' }],
      },
    })
    expect(bill.status(), await bill.text()).toBeLessThan(300)

    const context = await signedInBrowser(browser, baseURL, cookie)
    const page = await context.newPage()
    const problems = watch(page)

    await page.goto(`/backend/purchasing/orders/${order.id}`)
    await page.getByRole('button', { name: 'ผูกบิลที่มีอยู่' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(dialog.getByText('ผูกบิลที่มีอยู่').first()).toBeVisible()

    // The bill picker lists only this vendor's unlinked bills. Choosing one
    // reveals its lines, each with a "which order line is this" select.
    const billPick = dialog.locator('select').filter({ hasText: 'เลือกบิล' })
    await expect(billPick.locator('option')).not.toHaveCount(1, { timeout: 15_000 })
    await billPick.selectOption({ index: 1 })
    const orderLinePick = dialog.getByLabel('ตรงกับรายการที่สั่ง').first()
    await expect(orderLinePick).toBeVisible({ timeout: 15_000 })
    // The dialog proposes a match: the order line posting to the same account
    // as the bill line. So the button is ready at once…
    await expect(orderLinePick).not.toHaveValue('')
    await expect(dialog.getByRole('button', { name: 'ผูกบิล' })).toBeEnabled()
    // …and waits again the moment the operator declines the match.
    await orderLinePick.selectOption({ index: 0 })
    await expect(dialog.getByRole('button', { name: 'ผูกบิล' })).toBeDisabled()
    await orderLinePick.selectOption({ index: 1 })
    await expect(dialog.getByRole('button', { name: 'ผูกบิล' })).toBeEnabled()
    await dialog.getByRole('button', { name: 'ผูกบิล' }).click()
    await expect(dialog).toBeHidden({ timeout: 20_000 })

    // The third number of the match is now on the screen and in the record.
    await expect(page.getByText('7,000.00').first()).toBeVisible({ timeout: 20_000 })
    const after = await readJson(await request.get(`/api/orva_purchasing/orders/${order.id}`))
    expect(Number((after.lines as Array<Json>)[0].billedAmount)).toBe(7000)

    expect(problems, problems.join(' | ')).toEqual([])
    await context.close()
  })

  test('closing and cancelling each ask for a reason, and then the order offers no more moves', async ({ browser, baseURL }) => {
    test.setTimeout(60_000)
    const toClose = await sentOrder(request, {
      vendorPartyId: fixture.vendorPartyId, accountId: fixture.accountId, description: 'ค่าเช่าเครื่องบรรจุ', quantity: 3, unitPrice: 4000,
    })
    const toCancel = await sentOrder(request, {
      vendorPartyId: fixture.vendorPartyId, accountId: fixture.accountId, description: 'ค่าออกแบบที่ไม่เกิดขึ้น', quantity: 1, unitPrice: 9000,
    })

    const context = await signedInBrowser(browser, baseURL, cookie)
    const page = await context.newPage()
    const problems = watch(page)

    // Close: the reason is required, and the hint says what closing records.
    await page.goto(`/backend/purchasing/orders/${toClose.id}`)
    await page.getByRole('button', { name: 'ปิดใบสั่งซื้อ' }).click()
    let dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(dialog.getByText(/ส่วนที่ขาด/)).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'ปิดใบสั่งซื้อ' })).toBeDisabled()
    await dialog.locator('input').fill('ผู้ขายส่งไม่ครบ ตกลงยุติ')
    await dialog.getByRole('button', { name: 'ปิดใบสั่งซื้อ' }).click()
    await expect(dialog).toBeHidden({ timeout: 15_000 })
    await expect(page.getByText('ปิดแล้ว').first()).toBeVisible({ timeout: 15_000 })
    // A closed order is settled: nothing can arrive, nothing can be closed twice.
    await expect(page.getByRole('button', { name: 'รับของ' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'ปิดใบสั่งซื้อ' })).toHaveCount(0)
    let after = await readJson(await request.get(`/api/orva_purchasing/orders/${toClose.id}`))
    expect((after.order as Json).status).toBe('closed')

    // Cancel: for an order that never happened at all.
    await page.goto(`/backend/purchasing/orders/${toCancel.id}`)
    await page.getByRole('button', { name: 'ยกเลิกใบสั่งซื้อ' }).click()
    dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(dialog.getByText(/ไม่เกิดขึ้นเลย/)).toBeVisible()
    await dialog.locator('input').fill('ผู้ขายไม่รับงาน')
    await dialog.getByRole('button', { name: 'ยกเลิกใบสั่งซื้อ' }).click()
    await expect(dialog).toBeHidden({ timeout: 15_000 })
    await expect(page.getByText('ยกเลิกแล้ว').first()).toBeVisible({ timeout: 15_000 })
    after = await readJson(await request.get(`/api/orva_purchasing/orders/${toCancel.id}`))
    expect((after.order as Json).status).toBe('cancelled')

    // …and an order that has goods against it cannot be cancelled at all:
    // the fixture's order was partially received earlier in this file.
    await page.goto(`/backend/purchasing/orders/${fixture.sentId}`)
    await expect(page.getByRole('button', { name: 'รับของ' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'ยกเลิกใบสั่งซื้อ' })).toHaveCount(0)

    expect(problems, problems.join(' | ')).toEqual([])
    await context.close()
  })

  test('the ใบสั่งซื้อ sheet prints in the browser with the parties the right way round', async ({ browser, baseURL }) => {
    const context = await signedInBrowser(browser, baseURL, cookie)
    const page = await context.newPage()
    const problems = watch(page)

    await page.goto(`/backend/documents/preview?type=purchase_order&documentId=${fixture.sentId}`)
    const sheet = page.locator('[data-document-sheet="true"]').first()
    await expect(sheet).toBeVisible({ timeout: 30_000 })
    const printed = (await sheet.innerText()).replace(/\s+/g, ' ')

    expect(printed).toContain('ใบสั่งซื้อ')
    expect(printed).toContain(fixture.sentNumber)
    // We issue it, the vendor receives it: the blocks are titled by role, not
    // by the sales default of ผู้ขาย / ลูกค้า.
    expect(printed).toContain('ผู้ซื้อ')
    expect(printed).toContain('ผู้ขาย')
    expect(printed).toContain(fixture.vendorName)
    expect(printed).toContain('ค่าขนส่งล็อตกันยายน')
    // A purchase order states its money, unlike a delivery note.
    expect(printed).toContain('700.00')
    // Not a tax document: one sheet, no taxpayer-id block demanded.
    expect(printed).not.toContain('สำเนา')

    expect(problems, problems.join(' | ')).toEqual([])
    await context.close()
  })

  test('at 375px nothing scrolls sideways, and dark mode still reads', async ({ browser, baseURL }) => {
    const context = await signedInBrowser(browser, baseURL, cookie, {
      viewport: { width: 375, height: 812 },
      colorScheme: 'dark',
    })
    const page = await context.newPage()
    const problems = watch(page)

    for (const path of ['/backend/purchasing/orders', `/backend/purchasing/orders/${fixture.sentId}`]) {
      await page.goto(path)
      await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 30_000 })
      // A page that scrolls sideways on a phone hides its own actions. Wide
      // content is allowed to scroll inside its own box, never the document.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, `${path} scrolls sideways by ${overflow}px at 375px`).toBeLessThanOrEqual(1)
      // Dark mode: the page paints its own ground rather than inheriting white.
      const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
      expect(background, `${path} has no background in dark mode`).not.toBe('rgba(0, 0, 0, 0)')
    }

    expect(problems, problems.join(' | ')).toEqual([])
    await context.close()
  })
})
