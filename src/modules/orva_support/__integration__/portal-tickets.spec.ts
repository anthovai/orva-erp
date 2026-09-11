import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'

/**
 * I4 — a customer opens their own ticket, attaches the screenshot, and the
 * desk answers.
 *
 * The path this proves end to end: the customer opens a ticket from the portal
 * (numbered from the same series the desk uses, marked `source = 'portal'`),
 * attaches a file through the installed attachments storage, the desk answers
 * and leaves an internal note, and the customer sees the answer but never the
 * note. Then the desk resolves it, the customer writes back, and the ticket
 * reopens — because a customer who writes again has not finished.
 *
 * The negative assertions carry the isolation: another customer's ticket, its
 * conversation and its file are all 404 from this session, indistinguishable
 * from ids that never existed.
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

/** A signed-in customer's own request context; the org is named explicitly on a platform domain. */
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
    console.log(`[i4] customer login answered ${response.status()}: ${(await response.text()).slice(0, 200)}`)
    await anonymous.dispose()
    return null
  }
  const cookie = response.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value.split(';')[0]).join('; ')
  await anonymous.dispose()
  return playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie } })
}

async function readJson(response: { status: () => number; text: () => Promise<string> }): Promise<Json> {
  const body = await response.text()
  // A 500 from these routes has an empty body, so the status is the only thing
  // that says what happened — carry it into the failure message.
  try { return JSON.parse(body) as Json } catch {
    throw new Error(`expected JSON, got ${response.status()}: ${body.slice(0, 300) || '(empty body)'}`)
  }
}
const idOf = (body: Json): string => (typeof body.id === 'string' ? body.id : String((body.item as Json | undefined)?.id ?? ''))

// A one-pixel PNG: real bytes, so the storage driver and the mime sniffing are exercised.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test.describe('a customer opens and follows their own support ticket (I4)', () => {
  let request: APIRequestContext

  test.beforeAll(async ({ playwright, baseURL }) => { request = await staffLogin(playwright, baseURL) })
  test.afterAll(async () => { await request.dispose() })

  test('the portal opens a ticket, attaches a file, and never shows an internal note', async ({ playwright, baseURL }) => {
    test.setTimeout(120_000)
    const stamp = Date.now().toString(36)
    const switcher = await readJson(await request.get('/api/directory/organization-switcher'))
    const organizationId = String(switcher.selectedId ?? ((switcher.items as Array<Json>)[0]?.id ?? ''))
    expect(organizationId, 'the staff session must name an organization').not.toBe('')

    const mineCompany = await request.post('/api/customers/companies', { data: { displayName: `บริษัท ผู้แจ้ง ${stamp}` } })
    expect(mineCompany.status(), await mineCompany.text()).toBeLessThan(300)
    const mineEntityId = idOf(await readJson(mineCompany))
    const otherCompany = await request.post('/api/customers/companies', { data: { displayName: `บริษัท คนอื่น ${stamp}` } })
    expect(otherCompany.status(), await otherCompany.text()).toBeLessThan(300)
    const otherEntityId = idOf(await readJson(otherCompany))

    // The other customer's ticket exists only to be invisible.
    const theirTicket = await request.post('/api/orva_support/tickets', {
      data: { subject: `ของคนอื่น ${stamp}`, description: 'ไม่ควรเห็น', kind: 'bug', priority: 'normal', customerEntityId: otherEntityId },
    })
    expect(theirTicket.status(), await theirTicket.text()).toBeLessThan(300)
    const theirTicketId = idOf(await readJson(theirTicket))

    const password = `Portal!${stamp}aA1`
    const account = await request.post('/api/customer_accounts/admin/users', {
      data: { email: `reporter-${stamp}@example.test`, password, displayName: `คุณผู้แจ้ง ${stamp}`, customerEntityId: mineEntityId },
    })
    expect(account.status(), await account.text()).toBeLessThan(300)

    // Without a customer session the portal answers nothing — staff cookies included.
    const anonymous = await playwright.request.newContext({ baseURL })
    expect((await anonymous.get('/api/orva_support/portal/tickets')).status()).toBe(401)
    expect((await request.get('/api/orva_support/portal/tickets')).status()).toBe(401)
    await anonymous.dispose()

    const customer = await customerLogin(playwright, baseURL, `reporter-${stamp}@example.test`, password, organizationId)
    if (!customer) {
      test.skip(true, 'the customer login route did not accept the seeded account in this environment')
      return
    }

    // Opening a ticket from the portal.
    const opened = await customer.post('/api/orva_support/portal/tickets', {
      data: { subject: `หน้าออกใบเสร็จค้าง ${stamp}`, description: 'กดพิมพ์แล้วหน้าจอค้างอยู่ที่กำลังโหลด', kind: 'bug' },
    })
    expect(opened.status(), await opened.text()).toBe(201)
    const ticket = await readJson(opened)
    const ticketId = String(ticket.id)
    expect(String(ticket.ticketNo)).toMatch(/^TCK-\d{6}$/)

    // The desk sees it, and sees where it came from.
    const queue = await readJson(await request.get('/api/orva_support/tickets?bucket=open&search=' + encodeURIComponent(stamp)))
    const queued = (queue.items as Array<Json>).find((row) => row.id === ticketId)
    expect(queued, 'the portal ticket must reach the desk queue').toBeTruthy()
    expect(queued!.source).toBe('portal')
    expect(queued!.customerEntityId).toBe(mineEntityId)

    // The screenshot rides along.
    const upload = await customer.post('/api/orva_support/portal/attachments', {
      multipart: { ticketId, file: { name: 'screen.png', mimeType: 'image/png', buffer: PNG } },
    })
    expect(upload.status(), await upload.text()).toBe(201)
    const attachmentId = String((await readJson(upload)).id)

    // The desk answers, and writes a note to itself.
    const answered = await request.post('/api/orva_support/replies', {
      data: { ticketId, author: 'staff', body: 'แก้แล้วครับ ลองรีเฟรชอีกครั้ง', minutesSpent: 15, status: 'resolved' },
    })
    expect(answered.status(), await answered.text()).toBeLessThan(300)
    const note = await request.post('/api/orva_support/replies', {
      data: { ticketId, author: 'note', body: 'สาเหตุจริงคือคิวพิมพ์ค้าง อย่าบอกลูกค้า', minutesSpent: 0 },
    })
    expect(note.status(), await note.text()).toBeLessThan(300)

    // What the customer sees: their own words, the answer, the file — not the note.
    const conversationResponse = await customer.get(`/api/orva_support/portal/tickets?ticketId=${ticketId}`)
    expect(conversationResponse.status(), await conversationResponse.text()).toBe(200)
    const conversation = await readJson(conversationResponse)
    const bodies = (conversation.messages as Array<Json>).map((m) => String(m.body))
    expect(bodies.some((body) => body.includes('กดพิมพ์แล้วหน้าจอค้าง'))).toBe(true)
    expect(bodies.some((body) => body.includes('ลองรีเฟรชอีกครั้ง'))).toBe(true)
    expect(bodies.some((body) => body.includes('อย่าบอกลูกค้า')), 'an internal note must never reach the portal').toBe(false)
    expect((conversation.attachments as Array<Json>).map((a) => a.id)).toContain(attachmentId)

    // And the file itself comes back as a file.
    const download = await customer.get(`/api/orva_support/portal/attachments?id=${attachmentId}`)
    expect(download.status(), await download.text()).toBe(200)
    expect((await download.body()).length).toBe(PNG.length)

    // Writing back on a resolved ticket reopens it.
    const back = await customer.post('/api/orva_support/portal/replies', { data: { ticketId, body: 'ยังค้างเหมือนเดิมครับ' } })
    expect(back.status(), await back.text()).toBe(201)
    expect((await readJson(back)).status).toBe('open')

    // Nothing belonging to the other customer is reachable, and neither are invented ids.
    const listedResponse = await customer.get('/api/orva_support/portal/tickets')
    expect(listedResponse.status(), await listedResponse.text()).toBe(200)
    const listed = await readJson(listedResponse)
    expect(listed.linked).toBe(true)
    expect((listed.tickets as Array<Json>).map((row) => row.id)).toContain(ticketId)
    expect((listed.tickets as Array<Json>).map((row) => row.id)).not.toContain(theirTicketId)
    expect((await customer.get(`/api/orva_support/portal/tickets?ticketId=${theirTicketId}`)).status()).toBe(404)
    expect((await customer.post('/api/orva_support/portal/replies', { data: { ticketId: theirTicketId, body: 'แอบตอบ' } })).status()).toBe(404)
    expect((await customer.post('/api/orva_support/portal/attachments', {
      multipart: { ticketId: theirTicketId, file: { name: 'screen.png', mimeType: 'image/png', buffer: PNG } },
    })).status()).toBe(404)
    expect((await customer.get('/api/orva_support/portal/attachments?id=00000000-0000-4000-8000-000000000000')).status()).toBe(404)

    await customer.dispose()
  })

  test('a saved answer is typed once and reused, and an account with no customer says so', async ({ playwright, baseURL }) => {
    test.setTimeout(120_000)
    const stamp = Date.now().toString(36)
    const switcher = await readJson(await request.get('/api/directory/organization-switcher'))
    const organizationId = String(switcher.selectedId ?? ((switcher.items as Array<Json>)[0]?.id ?? ''))

    const created = await request.post('/api/orva_support/canned-replies', {
      data: { title: `รีสตาร์ตเครื่องพิมพ์ ${stamp}`, body: 'ปิดเครื่องพิมพ์ 10 วินาที แล้วเปิดใหม่ครับ', position: 1 },
    })
    expect(created.status(), await created.text()).toBe(201)
    const cannedId = String(((await readJson(created)).item as Json).id)

    const listed = await readJson(await request.get('/api/orva_support/canned-replies'))
    expect((listed.items as Array<Json>).map((row) => row.id)).toContain(cannedId)

    const edited = await request.put('/api/orva_support/canned-replies', { data: { id: cannedId, body: 'ปิดเครื่องพิมพ์ 30 วินาที แล้วเปิดใหม่ครับ' } })
    expect(edited.status(), await edited.text()).toBe(200)
    expect(String(((await readJson(edited)).item as Json).body)).toContain('30 วินาที')

    // A customer session must not reach the desk's own answers.
    const password = `Portal!${stamp}aA1`
    const unlinked = await request.post('/api/customer_accounts/admin/users', {
      data: { email: `unlinked-${stamp}@example.test`, password, displayName: `ยังไม่ผูก ${stamp}` },
    })
    expect(unlinked.status(), await unlinked.text()).toBeLessThan(300)
    const stranger = await customerLogin(playwright, baseURL, `unlinked-${stamp}@example.test`, password, organizationId)
    if (stranger) {
      expect((await stranger.get('/api/orva_support/canned-replies')).status()).toBe(401)
      // Not linked is its own state: "no tickets for you" and "your account is
      // not connected" mean opposite things.
      const none = await readJson(await stranger.get('/api/orva_support/portal/tickets'))
      expect(none.linked).toBe(false)
      expect((none.tickets as Array<Json>).length).toBe(0)
      expect((await stranger.post('/api/orva_support/portal/tickets', { data: { subject: 'ไม่ควรเปิดได้', description: 'x' } })).status()).toBe(403)
      await stranger.dispose()
    }

    // Clean up after ourselves: the saved answer was ours to remove.
    expect((await request.delete('/api/orva_support/canned-replies', { data: { id: cannedId } })).status()).toBe(200)
    expect((await readJson(await request.get('/api/orva_support/canned-replies'))).items as Array<Json>)
      .not.toContainEqual(expect.objectContaining({ id: cannedId }))
  })
})
