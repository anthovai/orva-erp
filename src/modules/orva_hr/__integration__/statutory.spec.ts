import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'

/**
 * I1 — a paid month becomes the paperwork that has to be filed.
 *
 * Seeds the posting accounts, a fiscal period, a staff member and an
 * employment record carrying the statutory identity, then runs a payroll
 * month and asserts ภ.ง.ด.1, สปส.1-10 and the annual 50 ทวิ against the run's
 * own figures. Two things are checked that no unit test can: that the
 * encrypted columns survive a round trip through the API (the detail route
 * returns the national id the operator typed, not ciphertext), and that a
 * national id failing its check digit is refused at the door.
 *
 * The payroll figures come from the Rust sidecar. When it is not running the
 * suite still proves the identity, the validation and the empty-month
 * behaviour, and says which half was skipped rather than pretending.
 *
 * Harness fixtures in an ephemeral database; the session cookie is carried
 * explicitly because the ephemeral app is a production build.
 */

const CREDENTIALS = { email: 'admin@acme.com', password: 'secret' }
type Json = Record<string, unknown>

// Checksum-valid ids, computed with the rule in lib/statutory.ts.
const VALID_ID = '1101010101011'
const INVALID_ID = '1101010101015'

async function login(playwright: PlaywrightWorkerArgs['playwright'], baseURL: string | undefined): Promise<{ request: APIRequestContext; cookie: string }> {
  const anonymous = await playwright.request.newContext({ baseURL })
  const response = await anonymous.post('/api/auth/login', { form: CREDENTIALS })
  expect(response.status(), await response.text()).toBe(200)
  const cookie = response.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value.split(';')[0]).join('; ')
  await anonymous.dispose()
  return { request: await playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie } }), cookie }
}

async function readJson(response: { text: () => Promise<string> }): Promise<Json> {
  const body = await response.text()
  try { return JSON.parse(body) as Json } catch { throw new Error(`expected JSON, got: ${body.slice(0, 300)}`) }
}
const idOf = (body: Json): string => {
  if (typeof body.id === 'string') return body.id
  const item = body.item as Json | undefined
  return typeof item?.id === 'string' ? item.id : ''
}

async function ensureAccount(request: APIRequestContext, code: string, name: string, accountType: string): Promise<string> {
  const existing = await request.get(`/api/orva_finance/gl/accounts?page=1&pageSize=100&search=${encodeURIComponent(code)}`)
  const found = (((await readJson(existing)).items ?? []) as Array<{ id: string; code: string }>).find((a) => a.code === code)
  if (found) return found.id
  const created = await request.post('/api/orva_finance/gl/accounts', { data: { code, name, accountType, isActive: true } })
  expect(created.status(), await created.text()).toBeLessThan(300)
  return String((await readJson(created)).id)
}

/** The five posting accounts payroll needs, plus the employer registration the filings need. */
async function ensureHrSettings(request: APIRequestContext): Promise<void> {
  const [salary, ssoExpense, ssoPayable, taxPayable, netPayable] = await Promise.all([
    ensureAccount(request, '5000', 'เงินเดือนพนักงาน', 'expense'),
    ensureAccount(request, '5300', 'เงินสมทบประกันสังคม (นายจ้าง)', 'expense'),
    ensureAccount(request, '2210', 'ประกันสังคมค้างจ่าย', 'liability'),
    ensureAccount(request, '2220', 'ภาษีหัก ณ ที่จ่ายค้างนำส่ง', 'liability'),
    ensureAccount(request, '2230', 'เงินเดือนค้างจ่าย', 'liability'),
  ])
  const put = await request.put('/api/orva_hr/settings', {
    data: {
      salaryExpenseAccountId: salary, ssoExpenseAccountId: ssoExpense, ssoPayableAccountId: ssoPayable,
      taxPayableAccountId: taxPayable, netPayableAccountId: netPayable,
      ssoEmployerNo: '1234567890', ssoBranchCode: '000000', filerName: 'ผู้จัดการ ทดสอบ', filerPosition: 'กรรมการ',
    },
  })
  expect(put.status(), await put.text()).toBe(200)
}

/** The seller identity the returns print as the employer. */
async function ensureEmployerIdentity(request: APIRequestContext): Promise<void> {
  const current = await readJson(await request.get('/api/orva_documents/settings'))
  const { updatedAt: _u, ...rest } = current
  void _u
  const put = await request.put('/api/orva_documents/settings', {
    data: { ...rest, sellerName: (rest.sellerName as string) || 'บริษัท ทดสอบ จำกัด', sellerTaxId: (rest.sellerTaxId as string) || '0105566000000' },
  })
  expect(put.status(), await put.text()).toBe(200)
}

async function ensurePeriod(request: APIRequestContext, month: string): Promise<string> {
  const list = await readJson(await request.get('/api/orva_finance/gl/periods?page=1&pageSize=100'))
  const found = ((list.items ?? []) as Array<{ id: string; code: string }>).find((p) => p.code === month)
  if (found) return found.id
  const [y, m] = month.split('-').map(Number)
  const created = await request.post('/api/orva_finance/gl/periods', {
    data: { code: month, startsOn: `${month}-01`, endsOn: `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` },
  })
  expect(created.status(), await created.text()).toBeLessThan(300)
  return String((await readJson(created)).id)
}

test.describe('payroll filings (I1)', () => {
  let request: APIRequestContext
  let cookie: string

  test.beforeAll(async ({ playwright, baseURL }) => {
    ;({ request, cookie } = await login(playwright, baseURL))
  })
  test.afterAll(async () => { await request.dispose() })

  test('an employee carries the identity the returns need, and the encrypted fields survive the round trip', async () => {
    const stamp = Date.now().toString(36)
    const member = await request.post('/api/staff/team-members', { data: { displayName: `พนักงานทดสอบ ${stamp}` } })
    expect(member.status(), await member.text()).toBeLessThan(300)
    const staffMemberId = idOf(await readJson(member))

    // A national id that fails its check digit never reaches the database.
    const refused = await request.post('/api/orva_hr/employees', {
      data: { staffMemberId, monthlySalary: 30000, nationalId: INVALID_ID },
    })
    expect(refused.status(), 'a bad check digit must be refused').toBe(400)

    const created = await request.post('/api/orva_hr/employees', {
      data: {
        staffMemberId, monthlySalary: 65000, position: 'นักพัฒนา', hireDate: '2026-01-01',
        titleTh: 'นาย', firstNameTh: 'สมชาย', lastNameTh: `ทดสอบ${stamp}`,
        nationalId: `${VALID_ID.slice(0, 1)}-${VALID_ID.slice(1, 5)}-${VALID_ID.slice(5, 10)}-${VALID_ID.slice(10, 12)}-${VALID_ID.slice(12)}`,
        address: '1 ถนนทดสอบ กรุงเทพฯ 10110', bankName: 'กสิกรไทย', bankAccountNo: '123-4-56789-0',
      },
    })
    expect(created.status(), await created.text()).toBeLessThan(300)
    const employeeId = idOf(await readJson(created))

    // The detail route decrypts; punctuation was stripped on the way in.
    const detail = await readJson(await request.get(`/api/orva_hr/employees/detail?id=${employeeId}`))
    expect(detail).toMatchObject({
      nationalId: VALID_ID,
      titleTh: 'นาย',
      firstNameTh: 'สมชาย',
      address: '1 ถนนทดสอบ กรุงเทพฯ 10110',
      bankAccountNo: '123-4-56789-0',
    })
    expect(String(detail.employeeNo)).toMatch(/^EMP-\d{4}$/)

    // The list index must NOT be able to serve those columns in the clear.
    // Fetched by id rather than by search: the list searches the staff name
    // snapshot, which is not the Thai family name typed above.
    const list = await readJson(await request.get(`/api/orva_hr/employees?page=1&pageSize=50&ids=${employeeId}`))
    const listed = ((list.items ?? []) as Array<Json>).find((r) => r.id === employeeId)
    expect(listed, 'the employee is listed').toBeTruthy()
    expect(JSON.stringify(listed)).not.toContain(VALID_ID)

    const gone = await request.delete('/api/orva_hr/employees', { data: { id: employeeId } })
    expect(gone.status()).toBe(200)
  })

  test('a paid month produces ภ.ง.ด.1, สปส.1-10 and the annual certificate from the run itself', async ({ browser, baseURL }) => {
    test.setTimeout(180_000)
    const engineUp = await request.get('/api/orva_hr/settings').then(() => true).catch(() => false)
    expect(engineUp).toBe(true)

    const stamp = Date.now().toString(36)
    const month = '2026-11'
    await ensureEmployerIdentity(request)
    await ensureHrSettings(request)
    const periodId = await ensurePeriod(request, month)

    const member = await request.post('/api/staff/team-members', { data: { displayName: `ลูกจ้าง ${stamp}` } })
    expect(member.status(), await member.text()).toBeLessThan(300)
    const staffMemberId = idOf(await readJson(member))
    const created = await request.post('/api/orva_hr/employees', {
      data: {
        staffMemberId, monthlySalary: 65000,
        titleTh: 'นาย', firstNameTh: 'สมชาย', lastNameTh: `ทดสอบ${stamp}`,
        nationalId: VALID_ID, address: '1 ถนนทดสอบ กรุงเทพฯ',
      },
    })
    expect(created.status(), await created.text()).toBeLessThan(300)
    const employeeId = idOf(await readJson(created))

    // An empty month is not filable, and says so rather than showing zeros as ready.
    const empty = await readJson(await request.get('/api/orva_hr/statutory/pnd1?month=2026-12'))
    expect(empty).toMatchObject({ ready: false, runStatus: null })
    expect((empty.totals as Json).count).toBe(0)

    const run = await request.post('/api/orva_hr/payroll-runs', { data: { monthCode: month, periodId, payDate: `${month}-30` } })
    expect(run.status(), await run.text()).toBeLessThan(300)
    const runId = idOf(await readJson(run))

    const calculated = await request.post('/api/orva_hr/payroll-runs/calculate', { data: { id: runId } })
    if (calculated.status() === 503) {
      console.log('[i1] payroll engine not running; the figures half is covered by the unit tests only')
      await request.delete('/api/orva_hr/employees', { data: { id: employeeId } })
      return
    }
    expect(calculated.status(), await calculated.text()).toBe(200)

    const posted = await request.post('/api/orva_hr/payroll-runs/post', { data: { id: runId } })
    expect(posted.status(), await posted.text()).toBe(200)

    // ภ.ง.ด.1 — the engine's own figures for a 65,000 salary.
    const pnd1 = await readJson(await request.get(`/api/orva_hr/statutory/pnd1?month=${month}`))
    const pnd1Rows = pnd1.rows as Array<Json>
    const mine = pnd1Rows.find((r) => r.employeeId === employeeId)
    expect(mine, 'the employee appears on the return').toBeTruthy()
    expect(mine).toMatchObject({ name: `นาย สมชาย ทดสอบ${stamp}`, nationalId: VALID_ID, incomeType: '40(1)', gross: 65000, wht: 3679.17, problems: [] })
    expect(pnd1).toMatchObject({ runStatus: 'posted', ready: true })
    expect((pnd1.employer as Json).ssoEmployerNo).toBe('1234567890')

    // สปส.1-10 — both halves, straight from the run.
    const sso = await readJson(await request.get(`/api/orva_hr/statutory/sso?month=${month}`))
    const ssoRow = (sso.rows as Array<Json>).find((r) => r.employeeId === employeeId)
    expect(ssoRow).toMatchObject({ ssoNumber: VALID_ID, wage: 65000, employeeContribution: 750, employerContribution: 750, problems: [] })
    expect((sso.totals as Json).total).toBe(Number((sso.totals as Json).employee) + Number((sso.totals as Json).employer))

    // The spreadsheet is a spreadsheet, with the BOM Excel needs for Thai.
    const csv = await request.get(`/api/orva_hr/statutory/pnd1?month=${month}&format=csv`)
    expect(csv.status()).toBe(200)
    expect(csv.headers()['content-type']).toContain('text/csv')
    const csvText = await csv.text()
    expect(csvText.charCodeAt(0)).toBe(0xfeff)
    expect(csvText).toContain(VALID_ID)

    // 50 ทวิ — the year adds up to the month that was posted.
    const cert = await readJson(await request.get(`/api/orva_hr/statutory/certificate?employeeId=${employeeId}&year=2026`))
    expect(cert).toMatchObject({ year: 2026, problems: [] })
    expect((cert.totals as Json).gross).toBe(65000)
    expect((cert.totals as Json).wht).toBe(3679.17)
    expect((cert.months as Array<Json>).map((m) => m.monthCode)).toContain(month)

    // The screens render both returns and the printed certificate.
    const context = await browser.newContext({ baseURL, viewport: { width: 1366, height: 900 } })
    const host = new URL(baseURL ?? 'http://127.0.0.1').hostname
    await context.addCookies([...cookie.split('; '), 'locale=th'].map((pair) => {
      const i = pair.indexOf('=')
      return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: host, path: '/', secure: false }
    }))
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`/backend/hr/statutory?month=${month}`)
    await expect(page.getByTestId('statutory-month')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('statutory-month').fill(month)
    await expect(page.getByTestId('pnd1-table')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('sso-table')).toBeVisible()
    await page.goto(`/backend/hr/statutory/certificate?employeeId=${employeeId}&year=2026`)
    await expect(page.getByText('หนังสือรับรองการหักภาษี ณ ที่จ่าย').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('ภ.ง.ด.1ก')).toBeVisible()
    expect(errors, 'no client-side error on the filing screens').toEqual([])
    await context.close()
  })
})
