import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page, type PlaywrightWorkerArgs } from '@playwright/test'

/**
 * TEST-004 — ค่าใช้จ่ายจ่ายสด, walked in a browser as the owner would.
 *
 * The screen was redesigned around three questions a receipt answers, with the
 * posting shown before the save. These prove the two journeys that matter —
 * a plain shop receipt, and a full tax invoice with 3% withheld — end to end:
 * the preview arithmetic on screen, the row that appears, and the journal the
 * API confirms. The payload contract is unchanged, so the same route that the
 * old twelve-field form used has to accept what the new form sends.
 *
 * Harness fixtures in an ephemeral database; the session cookie is carried
 * explicitly because the ephemeral app is a production build
 * (.ai/lessons.md → ephemeral-integration-env-gotchas).
 */

const CREDENTIALS = { email: 'admin@acme.com', password: 'secret' }
type Json = Record<string, unknown>

async function login(playwright: PlaywrightWorkerArgs['playwright'], baseURL: string | undefined) {
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

async function signedInBrowser(browser: Browser, baseURL: string | undefined, cookie: string, viewport = { width: 1366, height: 900 }): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL, viewport })
  const host = new URL(baseURL ?? 'http://127.0.0.1').hostname
  await context.addCookies(
    [...cookie.split('; '), 'locale=th'].map((pair) => {
      const index = pair.indexOf('=')
      return { name: pair.slice(0, index), value: pair.slice(index + 1), domain: host, path: '/', secure: false }
    }),
  )
  return context
}

function watch(page: Page): string[] {
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    if (/Failed to load resource|status of 4\d\d/i.test(message.text())) return
    problems.push(`console: ${message.text()}`)
  })
  return problems
}

async function readJson(response: { text: () => Promise<string> }): Promise<Json> {
  const body = await response.text()
  try { return JSON.parse(body) as Json } catch { throw new Error(`expected JSON, got: ${body.slice(0, 300)}`) }
}

/** An account by code, created when the ephemeral chart does not have it. */
async function ensureAccount(request: APIRequestContext, code: string, name: string, accountType: string): Promise<string> {
  const existing = await request.get(`/api/orva_finance/gl/accounts?page=1&pageSize=100&search=${encodeURIComponent(code)}`)
  expect(existing.status(), await existing.text()).toBe(200)
  const found = (((await readJson(existing)).items ?? []) as Array<{ id: string; code: string }>).find((a) => a.code === code)
  if (found) return found.id
  const created = await request.post('/api/orva_finance/gl/accounts', { data: { code, name, accountType, isActive: true } })
  expect(created.status(), await created.text()).toBeLessThan(300)
  const id = String((await readJson(created)).id ?? '')
  expect(id, `account ${code} must be created`).not.toBe('')
  return id
}

const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const monthEnd = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}

type Fixture = { cashName: string; expenseName: string; month: string }

/**
 * Two cash-like accounts (so the picker is the segmented control), an expense
 * category, the tax accounts AP settings need, and the current month open.
 */
async function seed(request: APIRequestContext): Promise<Fixture> {
  const today = localToday()
  const month = today.slice(0, 7)
  await ensureAccount(request, '1010', 'เงินสด', 'asset')
  await ensureAccount(request, '1020', 'ธนาคารกสิกรไทย', 'asset')
  const inputVat = await ensureAccount(request, '1300', 'ภาษีซื้อ', 'asset')
  const apAccount = await ensureAccount(request, '2100', 'เจ้าหนี้การค้า', 'liability')
  const whtPayable = await ensureAccount(request, '2200', 'ภาษีหัก ณ ที่จ่ายค้างนำส่ง', 'liability')
  await ensureAccount(request, '5800', 'ค่าเดินทางและพาหนะ', 'expense')

  const settings = await request.put('/api/orva_finance/ap/settings', {
    data: { apAccountId: apAccount, inputVatAccountId: inputVat, whtPayableAccountId: whtPayable },
  })
  expect(settings.status(), await settings.text()).toBeLessThan(300)

  const periods = await request.get(`/api/orva_finance/gl/periods?page=1&pageSize=100`)
  const open = (((await readJson(periods)).items ?? []) as Array<{ code: string; status: string }>).find((p) => p.code === month)
  if (!open) {
    const created = await request.post('/api/orva_finance/gl/periods', { data: { code: month, startsOn: `${month}-01`, endsOn: monthEnd(month) } })
    expect(created.status(), await created.text()).toBeLessThan(300)
  }
  return { cashName: 'ธนาคารกสิกรไทย', expenseName: 'ค่าเดินทางและพาหนะ', month }
}

async function pickCategory(page: Page, name: string) {
  await page.getByRole('combobox').filter({ hasText: /เลือกหมวดค่าใช้จ่าย|\d{4}/ }).first().click()
  await page.getByRole('option', { name: new RegExp(name) }).click()
}

const money = (row: Json) => ({ net: Number(row.net), vat: Number(row.vat), wht: Number(row.wht), paid: Number(row.paid) })
const previewText = async (page: Page) => (await page.locator('dl[aria-live="polite"]').innerText()).replace(/\s+/g, ' ')

test.describe('ค่าใช้จ่ายจ่ายสด (TEST-004)', () => {
  test.setTimeout(5 * 60_000)
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

  test('a shop receipt: three inputs, the posting is on screen first, and the row appears with its journal', async ({ browser, baseURL }) => {
    const context = await signedInBrowser(browser, baseURL, cookie)
    const page = await context.newPage()
    const problems = watch(page)

    await page.goto('/backend/ap/expenses')
    await expect(page.getByRole('heading', { name: 'ค่าใช้จ่ายจ่ายสด' }).first()).toBeVisible({ timeout: 30_000 })
    // The screen says what it is for in its first line.
    await expect(page.getByText(/กรอก 3 ขั้น/)).toBeVisible()

    await page.getByPlaceholder(/ร้านกาแฟ/).fill('ร้านกาแฟหน้าออฟฟิศ')
    await page.getByLabel(/ยอดรวมทั้งสิ้นที่จ่าย/).fill('85')
    await pickCategory(page, fixture.expenseName)
    // The bank is the default paid-from account: it is pre-selected, not chosen.
    await expect(page.getByRole('radio', { name: fixture.cashName })).toHaveAttribute('data-state', 'checked')

    // Before saving, the preview already shows what will be posted.
    const preview = await previewText(page)
    expect(preview).toContain('85.00')
    expect(preview).toMatch(/ภาษีซื้อ · ไม่มี/)
    expect(preview).toContain(fixture.cashName)

    const before = ((await readJson(await request.get(`/api/orva_finance/expenses?month=${fixture.month}`))).items ?? []) as Array<Json>
    await page.getByRole('button', { name: 'บันทึกและลงบัญชี' }).click()
    await expect(page.getByText(/ลงบัญชีแล้ว JE-.*เงินออก/).first()).toBeVisible({ timeout: 30_000 })

    // The row is in the month list, and the API agrees.
    await expect(page.getByRole('cell', { name: 'ร้านกาแฟหน้าออฟฟิศ' }).first()).toBeVisible({ timeout: 15_000 })
    const after = ((await readJson(await request.get(`/api/orva_finance/expenses?month=${fixture.month}`))).items ?? []) as Array<Json>
    expect(after.length).toBe(before.length + 1)
    const row = after.find((r) => r.payee === 'ร้านกาแฟหน้าออฟฟิศ') as Json
    // Amounts come back as numeric text ('85.0000', or '0' for a coalesced zero); compare as numbers.
    expect(money(row)).toEqual({ net: 85, vat: 0, wht: 0, paid: 85 })

    // The form is ready for the next receipt: cleared, bank still selected.
    await expect(page.getByPlaceholder(/ร้านกาแฟ/)).toHaveValue('')
    await expect(page.getByRole('radio', { name: fixture.cashName })).toHaveAttribute('data-state', 'checked')

    expect(problems, 'the screen must not throw').toEqual([])
    await context.close()
  })

  test('a full tax invoice with 3% withheld: VAT is split out, withholding computed, cash out shown, and posted the same way', async ({ browser, baseURL }) => {
    const context = await signedInBrowser(browser, baseURL, cookie)
    const page = await context.newPage()
    const problems = watch(page)

    await page.goto('/backend/ap/expenses')
    await expect(page.getByRole('heading', { name: 'ค่าใช้จ่ายจ่ายสด' }).first()).toBeVisible({ timeout: 30_000 })

    await page.getByPlaceholder(/ร้านกาแฟ/).fill('บริษัท ที่ปรึกษา จำกัด')
    await page.getByLabel(/ยอดรวมทั้งสิ้นที่จ่าย/).fill('107')
    await pickCategory(page, fixture.expenseName)

    // The tax questions stay folded until the receipt is a full tax invoice.
    await expect(page.getByLabel(/เลขผู้เสียภาษีผู้ขาย/)).toHaveCount(0)
    await page.getByRole('radio', { name: /ใบกำกับภาษีเต็มรูป/ }).click()
    await page.getByLabel(/เลขผู้เสียภาษีผู้ขาย/).fill('0105500000001')
    await page.getByLabel(/เลขที่ใบกำกับภาษี/).fill('INV-2026-0042')
    await expect(page.getByText(/VAT ที่แยกจากยอดรวม 7\.00 บาท \(ค่าใช้จ่าย 100\.00\)/)).toBeVisible()

    await page.getByRole('switch').click()
    // 3% is the default rate; the amount is computed from the pre-VAT 100.
    await expect(page.getByLabel(/จำนวนที่หัก/)).toHaveValue('3')

    const preview = await previewText(page)
    expect(preview).toContain('100.00')
    expect(preview).toMatch(/ภาษีซื้อ · เข้า ภ\.พ\.30 7\.00/)
    expect(preview).toMatch(/หัก ณ ที่จ่าย 3% · เข้า ภ\.ง\.ด\.3\/53 −3\.00/)
    expect(preview).toContain('104.00')

    await page.getByRole('button', { name: 'บันทึกและลงบัญชี' }).click()
    await expect(page.getByText(/ลงบัญชีแล้ว JE-.*104\.00/).first()).toBeVisible({ timeout: 30_000 })

    const items = ((await readJson(await request.get(`/api/orva_finance/expenses?month=${fixture.month}`))).items ?? []) as Array<Json>
    const row = items.find((r) => r.payee === 'บริษัท ที่ปรึกษา จำกัด') as Json
    expect(row, 'the tax invoice must be in the month').toBeTruthy()
    expect(money(row)).toEqual({ net: 100, vat: 7, wht: 3, paid: 104 })
    expect(row.documentNo).toBe('INV-2026-0042')

    expect(problems, 'the screen must not throw').toEqual([])
    await context.close()
  })

  test('at phone width everything is one column and the posting preview is still there', async ({ browser, baseURL }) => {
    const context = await signedInBrowser(browser, baseURL, cookie, { width: 375, height: 812 })
    const page = await context.newPage()
    const problems = watch(page)
    await page.goto('/backend/ap/expenses')
    await expect(page.getByRole('heading', { name: 'ค่าใช้จ่ายจ่ายสด' }).first()).toBeVisible({ timeout: 30_000 })
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(scrollWidth, 'the page must not scroll sideways on a phone').toBeLessThanOrEqual(375)
    await expect(page.locator('dl[aria-live="polite"]')).toBeVisible()
    expect(problems).toEqual([])
    await context.close()
  })
})
