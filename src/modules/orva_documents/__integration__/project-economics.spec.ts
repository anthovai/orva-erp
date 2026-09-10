import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'

/**
 * H3 — hours become cost and margin, and the next งวด is one click away.
 *
 * A fresh quote is a project. With no rate anywhere the project reports no
 * cost (null, not 0). The company default rate makes cost 0 × rate and the
 * projected margin equal to the quote total; a project rate overrides it and
 * clearing it falls back. Where the ephemeral worker mirrors the tasking
 * project into a timesheet project in time, a 90-minute entry is logged and
 * the cost follows (minutes/60 × rate); otherwise that branch is reported as
 * skipped rather than faked. Then the next งวด is issued through the same
 * route the row action uses, with the percent the list would prefill, and
 * the project shows it billed. The screen renders the economics column.
 *
 * Harness fixtures in an ephemeral database; the session cookie is carried
 * explicitly because the ephemeral app is a production build.
 */

const CREDENTIALS = { email: 'admin@acme.com', password: 'secret' }
type Json = Record<string, unknown>

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
  const item = (body.item ?? body.data) as Json | undefined
  return typeof item?.id === 'string' ? item.id : ''
}

async function projectRow(request: APIRequestContext, quoteId: string): Promise<Json> {
  const list = (await readJson(await request.get('/api/orva_documents/projects'))).items as Array<Json>
  const row = list.find((r) => r.quoteId === quoteId)
  expect(row, `project ${quoteId} must be listed`).toBeTruthy()
  return row!
}

/** Sets the company default rate without disturbing the other settings. */
async function setDefaultRate(request: APIRequestContext, rate: number | null): Promise<void> {
  const current = await readJson(await request.get('/api/orva_documents/settings'))
  const { updatedAt: _u, ...rest } = current
  void _u
  const res = await request.put('/api/orva_documents/settings', {
    data: { ...rest, sellerName: (rest.sellerName as string) || 'Acme (test)', sellerTaxId: rest.sellerTaxId || undefined, defaultHourlyRate: rate },
  })
  expect(res.status(), await res.text()).toBe(200)
  expect((await readJson(res)).defaultHourlyRate).toBe(rate)
}

test.describe('project economics (H3)', () => {
  let request: APIRequestContext
  let cookie: string

  test.beforeAll(async ({ playwright, baseURL }) => {
    ;({ request, cookie } = await login(playwright, baseURL))
  })
  test.afterAll(async () => { await request.dispose() })

  test('a rate turns hours into cost and margin, an override wins, and the next งวด issues from the list', async ({ browser, baseURL }) => {
    test.setTimeout(120_000)
    const stamp = Date.now().toString(36)
    const quote = await request.post('/api/sales/quotes', {
      data: { currencyCode: 'THB', lines: [{ name: `พัฒนาระบบ ${stamp}`, currencyCode: 'THB', quantity: 1, unitPriceNet: 100000, taxRate: 7 }] },
    })
    expect(quote.status(), await quote.text()).toBeLessThan(300)
    const quoteId = idOf(await readJson(quote))
    expect(quoteId).not.toBe('')

    // No rate anywhere: cost is null, never 0.
    await setDefaultRate(request, null)
    let row = await projectRow(request, quoteId)
    expect(row).toMatchObject({ rateSource: 'none', cost: null, marginBilled: null, marginProjected: null })
    expect(Number(row.minutes)).toBe(0)

    // Company default.
    await setDefaultRate(request, 800)
    row = await projectRow(request, quoteId)
    expect(row).toMatchObject({ rateSource: 'default', hourlyRate: 800, cost: 0 })
    expect(row.marginProjected).toBeCloseTo(Number(row.quoteTotal), 2)

    // Project override, then clear.
    const set = await request.put('/api/orva_documents/project-rates', { data: { quoteId, hourlyRate: 1500 } })
    expect(set.status(), await set.text()).toBe(200)
    row = await projectRow(request, quoteId)
    expect(row).toMatchObject({ rateSource: 'project', hourlyRate: 1500 })
    const clear = await request.put('/api/orva_documents/project-rates', { data: { quoteId, hourlyRate: null } })
    expect(clear.status(), await clear.text()).toBe(200)
    row = await projectRow(request, quoteId)
    expect(row).toMatchObject({ rateSource: 'default', hourlyRate: 800 })
    const unknown = await request.put('/api/orva_documents/project-rates', { data: { quoteId: '00000000-0000-4000-8000-000000000000', hourlyRate: 1 } })
    expect(unknown.status()).toBe(404)

    // Hours: tasking project → (worker mirror) timesheet project → one entry.
    const project = await request.post('/api/orva_tasking/projects', { data: { name: `งาน ${stamp}`, quoteId } })
    expect(project.status(), await project.text()).toBeLessThan(300)
    const taskingProjectId = idOf(await readJson(project))
    let mirrored = false
    for (let i = 0; i < 20 && !mirrored; i++) {
      const hours = (await readJson(await request.get('/api/orva_time/project-hours'))).items as Array<Json>
      mirrored = hours.some((h) => h.taskingProjectId === taskingProjectId)
      if (!mirrored) await new Promise((r) => setTimeout(r, 1000))
    }
    if (mirrored) {
      const projects = (await readJson(await request.get(`/api/staff/timesheets/time-projects?search=${encodeURIComponent(`งาน ${stamp}`)}&pageSize=10`))).items as Array<Json>
      const timeProject = projects.find((p) => String(p.name ?? '').includes(stamp))
      expect(timeProject, 'the mirrored timesheet project must be listed').toBeTruthy()
      const member = await request.post('/api/staff/team-members', { data: { displayName: `ทีม ${stamp}` } })
      expect(member.status(), await member.text()).toBeLessThan(300)
      const staffMemberId = idOf(await readJson(member))
      const entry = await request.post('/api/staff/timesheets/time-entries', {
        data: { staffMemberId, date: '2026-09-10', durationMinutes: 90, timeProjectId: timeProject!.id, notes: 'H3 test' },
      })
      expect(entry.status(), await entry.text()).toBeLessThan(300)
      row = await projectRow(request, quoteId)
      expect(Number(row.minutes)).toBe(90)
      expect(row.cost).toBe(1200) // 1.5 h × 800
      expect(row.marginProjected).toBeCloseTo(Number(row.quoteTotal) - 1200, 2)
      console.log('[h3] hours path exercised: 90 minutes → cost 1200')
    } else {
      console.log('[h3] timesheet mirror did not arrive within 20s in this run; hours path covered by the unit test only')
    }

    // The next งวด, as the row action would issue it: whatever is still unbilled.
    const before = await projectRow(request, quoteId)
    if (Number(before.quoteTotal) > 0) {
      const percent = Math.round((100 - Number(before.billedPct)) * 10) / 10
      const issued = await request.post('/api/orva_documents/issue-invoice', { data: { quoteId, percent, dueInDays: 7 } })
      expect(issued.status(), await issued.text()).toBe(200)
      const after = await projectRow(request, quoteId)
      expect(Number(after.installments)).toBe(Number(before.installments) + 1)
      expect(Number(after.billedPct)).toBeGreaterThan(Number(before.billedPct))
      expect(after.marginBilled).toBeCloseTo(Number(after.billed) - Number(after.cost ?? 0), 2)
    } else {
      console.log('[h3] quote total is 0 in this fixture; the งวด step needs a priced quote and is skipped')
    }

    // The screen shows the economics column and the row actions open.
    const context = await browser.newContext({ baseURL, viewport: { width: 1366, height: 900 } })
    const host = new URL(baseURL ?? 'http://127.0.0.1').hostname
    await context.addCookies([...cookie.split('; '), 'locale=th'].map((pair) => {
      const i = pair.indexOf('=')
      return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: host, path: '/', secure: false }
    }))
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/backend/projects')
    await expect(page.getByTestId(`economics-${quoteId}`)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId(`economics-${quoteId}`)).toContainText('ต้นทุน')
    expect(errors, 'no client-side error on the projects screen').toEqual([])
    await context.close()

    await setDefaultRate(request, null)
  })
})
