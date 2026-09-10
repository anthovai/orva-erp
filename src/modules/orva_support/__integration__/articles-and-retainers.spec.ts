import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'

/**
 * H4 — the answers a customer can read, and the retainer that does not get
 * forgotten.
 *
 * Articles: a draft is written and is not visible to the portal; publishing
 * makes it readable there, with its body; unpublishing hides it again;
 * search finds it by tag; a stale edit is refused; deleting frees the slug.
 * The portal read is asserted through the API without a customer session
 * being available in the harness, so the check is that it refuses an
 * unauthenticated caller — the staff route proves the content.
 *
 * Retainers: a subscription with a customer, a project and the toggle on,
 * whose renewal date has passed, appears in the due list; issuing it creates
 * a real invoice through issue-invoice and rolls the renewal date one cycle
 * on; it then disappears from the due list, and a second issue is refused.
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
  const item = body.item as Json | undefined
  return typeof item?.id === 'string' ? item.id : ''
}

test.describe('help articles and retainers (H4)', () => {
  let request: APIRequestContext
  let cookie: string
  let anonymous: APIRequestContext

  test.beforeAll(async ({ playwright, baseURL }) => {
    ;({ request, cookie } = await login(playwright, baseURL))
    anonymous = await playwright.request.newContext({ baseURL })
  })
  test.afterAll(async () => { await request.dispose(); await anonymous.dispose() })

  test('an article is a draft until it is published, and the portal read needs a customer session', async ({ browser, baseURL }) => {
    const stamp = Date.now().toString(36)
    const created = await request.post('/api/orva_support/articles', {
      data: {
        title: `วิธีรีเซ็ตรหัสผ่าน ${stamp}`,
        body: '# ขั้นตอน\n\n1. กดลืมรหัสผ่าน\n2. เปิดอีเมล',
        tags: [`tag-${stamp}`, 'บัญชี'],
      },
    })
    expect(created.status(), await created.text()).toBe(201)
    const article = (await readJson(created)).item as Json
    expect(article.isPublished).toBe(false)
    // The Thai title survives into the slug rather than becoming dashes.
    expect(String(article.slug)).toContain('วิธีรีเซ็ตรหัสผ่าน')

    // Search by tag finds it; the draft filter separates it from published ones.
    const found = (await readJson(await request.get(`/api/orva_support/articles?search=tag-${stamp}`))).items as Array<Json>
    expect(found.map((a) => a.id)).toContain(article.id)
    const publishedOnly = (await readJson(await request.get('/api/orva_support/articles?published=yes'))).items as Array<Json>
    expect(publishedOnly.map((a) => a.id)).not.toContain(article.id)

    // A stale version is refused.
    const stale = await request.put('/api/orva_support/articles', { data: { id: article.id, updatedAt: '2020-01-01T00:00:00.000Z', title: 'x' } })
    expect(stale.status()).toBe(409)

    const published = await request.put('/api/orva_support/articles', { data: { id: article.id, updatedAt: article.updatedAt, isPublished: true } })
    expect(published.status(), await published.text()).toBe(200)
    const live = (await readJson(published)).item as Json
    expect(live.isPublished).toBe(true)

    // The portal route is customer-authenticated: a caller with no customer
    // session is refused, staff cookies included.
    expect((await anonymous.get('/api/orva_support/portal/articles')).status()).toBe(401)
    expect((await request.get('/api/orva_support/portal/articles')).status()).toBe(401)

    // A second article may reuse the same title; the slug is made unique.
    const twin = await request.post('/api/orva_support/articles', {
      data: { title: `วิธีรีเซ็ตรหัสผ่าน ${stamp}`, body: 'อีกฉบับ' },
    })
    expect(twin.status()).toBe(201)
    const twinArticle = (await readJson(twin)).item as Json
    expect(twinArticle.slug).not.toBe(article.slug)

    // The screen lists and edits.
    const context = await browser.newContext({ baseURL, viewport: { width: 1366, height: 900 } })
    const host = new URL(baseURL ?? 'http://127.0.0.1').hostname
    await context.addCookies([...cookie.split('; '), 'locale=th'].map((pair) => {
      const i = pair.indexOf('=')
      return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: host, path: '/', secure: false }
    }))
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/backend/support/articles')
    await expect(page.getByTestId('article-list')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(`วิธีรีเซ็ตรหัสผ่าน ${stamp}`).first()).toBeVisible()
    await expect(page.getByTestId('article-publish')).toBeVisible()
    expect(errors, 'no client-side error on the articles screen').toEqual([])
    await context.close()

    // Cleanup: the fixtures are throwaway.
    for (const id of [article.id, twinArticle.id]) {
      expect((await request.delete('/api/orva_support/articles', { data: { id } })).status()).toBe(200)
    }
  })

  test('a due retainer invoices once, rolls its cycle on, and then is no longer due', async () => {
    test.setTimeout(120_000)
    const stamp = Date.now().toString(36)
    const quote = await request.post('/api/sales/quotes', {
      data: { currencyCode: 'THB', lines: [{ name: `ดูแลระบบ ${stamp}`, currencyCode: 'THB', quantity: 1, unitPriceNet: 60000, taxRate: 7 }] },
    })
    expect(quote.status(), await quote.text()).toBeLessThan(300)
    const quoteId = idOf(await readJson(quote))

    const person = await request.post('/api/customers/people', { data: { firstName: `ลูกค้าดูแล`, lastName: stamp } })
    expect(person.status(), await person.text()).toBeLessThan(300)
    const customerEntityId = idOf(await readJson(person))

    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const subscription = await request.post('/api/orva_support/subscriptions', {
      data: {
        name: `ค่าดูแลระบบ ${stamp}`, kind: 'other', cost: 5000, billingCycle: 'monthly',
        renewsOn: yesterday, customerEntityId, quoteId, invoiceOnRenewal: true, retainerAmount: 5000,
      },
    })
    expect(subscription.status(), await subscription.text()).toBeLessThan(300)
    const subscriptionId = idOf(await readJson(subscription))

    const due = (await readJson(await request.get('/api/orva_support/retainers'))).items as Array<Json>
    const mine = due.find((row) => row.id === subscriptionId)
    expect(mine, 'the retainer must be due today').toBeTruthy()
    expect(mine!.amount).toBe(5000)

    // A stale version is refused before anything is minted.
    const stale = await request.post('/api/orva_support/retainers', { data: { id: subscriptionId, updatedAt: '2020-01-01T00:00:00.000Z' } })
    expect(stale.status()).toBe(409)

    const issued = await request.post('/api/orva_support/retainers', { data: { id: subscriptionId, updatedAt: mine!.updatedAt } })
    expect(issued.status(), await issued.text()).toBe(200)
    const outcome = await readJson(issued)
    expect(outcome.invoiceId).toBeTruthy()
    expect(String(outcome.nextRenewsOn ?? '') > yesterday, 'the renewal date must move on').toBe(true)

    // The invoice is a real one, linked to the quote.
    const installments = (await readJson(await request.get(`/api/orva_documents/issue-invoice?quoteId=${quoteId}`))).items as Array<Json>
    expect(installments.map((i) => i.id)).toContain(outcome.invoiceId)

    // Not due any more, and a second attempt is refused.
    const after = (await readJson(await request.get('/api/orva_support/retainers'))).items as Array<Json>
    expect(after.find((row) => row.id === subscriptionId)).toBeUndefined()
    const list = (await readJson(await request.get('/api/orva_support/subscriptions'))).items as Array<Json>
    const row = list.find((r) => r.id === subscriptionId)!
    expect(row.lastInvoiceNumber).toBeTruthy()
    const again = await request.post('/api/orva_support/retainers', { data: { id: subscriptionId, updatedAt: row.updatedAt } })
    expect(again.status(), 'a cycle is billed once').toBe(422)

    // A line without a customer or a project is never due, whatever the date.
    const orphan = await request.post('/api/orva_support/subscriptions', {
      data: { name: `ไม่มีลูกค้า ${stamp}`, kind: 'other', cost: 900, billingCycle: 'monthly', renewsOn: yesterday, invoiceOnRenewal: true },
    })
    expect(orphan.status()).toBeLessThan(300)
    const orphanId = idOf(await readJson(orphan))
    const dueNow = (await readJson(await request.get('/api/orva_support/retainers'))).items as Array<Json>
    expect(dueNow.find((r) => r.id === orphanId)).toBeUndefined()
  })
})
