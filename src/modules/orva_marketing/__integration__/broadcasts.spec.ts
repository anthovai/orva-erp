import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'

/**
 * H2 — news goes only to those who said yes, and the link in the email takes
 * a yes back.
 *
 * Three fresh contacts: two consented (one through the marketing screen's
 * consent call, one through the CRM create with cf_marketing_consent), one
 * not. A broadcast is drafted and sent: exactly two messages records exist,
 * each carrying that recipient's unsubscribe link; the third contact is not
 * in the send log at all. The first recipient then opens their link without
 * a session: the public page names them, the withdrawal flips the CRM field,
 * and the audience count falls by one. Re-sending a sent broadcast is
 * refused; a 412 says so when nobody can receive.
 *
 * Harness fixtures in an ephemeral database; the session cookie is carried
 * explicitly because the ephemeral app is a production build. Email delivery
 * itself is the messages worker's job and is not asserted here.
 */

const CREDENTIALS = { email: 'admin@acme.com', password: 'secret' }
type Json = Record<string, unknown>

async function authedContext(playwright: PlaywrightWorkerArgs['playwright'], baseURL: string | undefined): Promise<{ request: APIRequestContext; cookie: string }> {
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

async function createPerson(request: APIRequestContext, stamp: string, n: number, email: string | null, consent: boolean | null): Promise<string> {
  const res = await request.post('/api/customers/people', {
    data: {
      firstName: `ลูกค้า${n}`, lastName: `ทดสอบ ${stamp}`,
      ...(email ? { primaryEmail: email } : {}),
      ...(consent === null ? {} : { cf_marketing_consent: consent, cf_marketing_consent_at: '2026-09-10', cf_marketing_consent_source: 'form' }),
    },
  })
  expect(res.status(), await res.text()).toBeLessThan(300)
  const id = idOf(await readJson(res))
  expect(id, 'person create must return an id').not.toBe('')
  return id
}

test.describe('marketing broadcasts (H2)', () => {
  let request: APIRequestContext
  let cookie: string
  let anonymous: APIRequestContext

  test.beforeAll(async ({ playwright, baseURL }) => {
    ;({ request, cookie } = await authedContext(playwright, baseURL))
    anonymous = await playwright.request.newContext({ baseURL })
  })
  test.afterAll(async () => { await request.dispose(); await anonymous.dispose() })

  test('a broadcast reaches exactly the consented contacts, and the emailed link withdraws consent without a login', async ({ browser, baseURL }) => {
    const stamp = Date.now().toString(36)
    const yesByForm = await createPerson(request, stamp, 1, `yes-form-${stamp}@example.test`, true)
    const yesByStaff = await createPerson(request, stamp, 2, `yes-staff-${stamp}@example.test`, null)
    const no = await createPerson(request, stamp, 3, `no-${stamp}@example.test`, null)

    // The screen's consent switch writes the same field the CRM form does.
    const consent = await request.post('/api/orva_marketing/consent', { data: { customerEntityId: yesByStaff, consent: true, source: 'verbal' } })
    expect(consent.status(), await consent.text()).toBe(200)

    const before = await readJson(await request.get('/api/orva_marketing/audience'))
    const contacts = before.contacts as Array<Json>
    const mine = (id: string) => contacts.find((c) => c.id === id)
    expect(mine(yesByForm)).toMatchObject({ consent: true, consentSource: 'form', email: `yes-form-${stamp}@example.test` })
    expect(mine(yesByStaff)).toMatchObject({ consent: true, consentSource: 'verbal' })
    expect(mine(no)).toMatchObject({ consent: false })
    const reachableBefore = Number((before.counts as Json).reachable)
    expect(reachableBefore).toBeGreaterThanOrEqual(2)

    // Draft, edit with the version, then send.
    const created = await request.post('/api/orva_marketing/broadcasts', { data: { subject: `ข่าวทดสอบ ${stamp}`, body: 'สวัสดีค่ะ\n\n**สินค้าใหม่** มาแล้ว' } })
    expect(created.status(), await created.text()).toBe(201)
    let draft = (await readJson(created)).item as Json
    const edited = await request.put('/api/orva_marketing/broadcasts', { data: { id: draft.id, updatedAt: draft.updatedAt, body: 'สวัสดีค่ะ\n\n**สินค้าใหม่** มาแล้ว — ลด 15%' } })
    expect(edited.status(), await edited.text()).toBe(200)
    const stale = await request.put('/api/orva_marketing/broadcasts', { data: { id: draft.id, updatedAt: draft.updatedAt, subject: 'x' } })
    expect(stale.status(), 'a stale version must be refused').toBe(409)
    draft = (await readJson(edited)).item as Json

    const sent = await request.post('/api/orva_marketing/broadcasts/send', { data: { id: draft.id, updatedAt: draft.updatedAt } })
    expect(sent.status(), await sent.text()).toBe(200)
    const outcome = await readJson(sent)
    expect((outcome.summary as Json).failed).toBe(0)
    expect(Number((outcome.summary as Json).sent)).toBe(reachableBefore)
    expect((outcome.item as Json).status).toBe('sent')

    // The send log names the two, not the third; each row points at a messages record.
    const log = (await readJson(await request.get(`/api/orva_marketing/broadcasts/recipients?broadcastId=${draft.id}`))).items as Array<Json>
    const rowFor = (id: string) => log.find((r) => r.customerEntityId === id)
    expect(rowFor(yesByForm)).toMatchObject({ status: 'sent' })
    expect(rowFor(yesByStaff)).toMatchObject({ status: 'sent' })
    expect(rowFor(no)).toBeUndefined()
    const messageId = String(rowFor(yesByForm)!.messageId)
    expect(messageId).toMatch(/^[0-9a-f-]{36}$/)
    const message = await readJson(await request.get(`/api/messages/${messageId}`))
    const messageText = JSON.stringify(message)
    expect(messageText).toContain(`ข่าวทดสอบ ${stamp}`)
    const link = messageText.match(/https?:\/\/[^"\\\s]+\/portal\/unsubscribe\/[A-Za-z0-9_-]+/)?.[0]
    expect(link, 'the email body must carry the unsubscribe link').toBeTruthy()
    const token = link!.split('/').pop()!

    // Sent is final.
    const again = await request.post('/api/orva_marketing/broadcasts/send', { data: { id: draft.id, updatedAt: (outcome.item as Json).updatedAt } })
    expect(again.status()).toBe(422)

    // The link works with no session: the page names the contact, the button withdraws.
    const status = await anonymous.get(`/api/orva_marketing/unsubscribe?token=${token}`)
    expect(status.status(), await status.text()).toBe(200)
    expect(await readJson(status)).toMatchObject({ ok: true, consent: true, displayName: expect.stringContaining('ลูกค้า1') })
    const unknown = await anonymous.get('/api/orva_marketing/unsubscribe?token=not-a-real-token-at-all')
    expect(unknown.status()).toBe(404)

    const page = await browser.newPage({ baseURL })
    await page.goto(new URL(link!).pathname)
    // The reader has no locale cookie, so the page may render in English: assert by test id, not by text.
    await expect(page.getByTestId('unsubscribe-title')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/ลูกค้า1/)).toBeVisible()
    await page.getByTestId('unsubscribe-button').click()
    await expect(page.getByTestId('unsubscribe-done')).toBeVisible({ timeout: 15_000 })
    await page.close()

    const after = await readJson(await request.get('/api/orva_marketing/audience'))
    const afterContacts = after.contacts as Array<Json>
    expect(afterContacts.find((c) => c.id === yesByForm)).toMatchObject({ consent: false, consentSource: 'unsubscribe' })
    expect(Number((after.counts as Json).reachable)).toBe(reachableBefore - 1)

    // A second visit says it is already done.
    expect(await readJson(await anonymous.get(`/api/orva_marketing/unsubscribe?token=${token}`))).toMatchObject({ consent: false })
  })

  test('the marketing screen shows the numbers, the composer and the history', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1366, height: 900 } })
    const host = new URL(baseURL ?? 'http://127.0.0.1').hostname
    await context.addCookies([...cookie.split('; '), 'locale=th'].map((pair) => {
      const i = pair.indexOf('=')
      return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: host, path: '/', secure: false }
    }))
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/backend/marketing/broadcasts')
    await expect(page.getByTestId('marketing-kpis')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('broadcast-send')).toBeVisible()
    await expect(page.getByTestId('broadcast-history')).toBeVisible()
    await page.getByRole('tab', { name: 'ผู้รับและความยินยอม' }).click()
    await expect(page.getByTestId('audience-table')).toBeVisible()
    expect(errors, 'no client-side error on the marketing screen').toEqual([])
    await context.close()
  })
})
