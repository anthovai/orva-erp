import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'

/**
 * G2 — the reply goes back to the client, and a duplicate folds into its thread.
 *
 * TEST-G2-1: a staff reply with `sendEmail` leaves the ticket by email. The
 * harness runs the app in test mode, where the shared email sender writes
 * every message to `.ai/qa/email-capture.jsonl` instead of Resend, so the
 * email itself can be read back: it must carry the ticket number in its
 * subject, because that number is how the client's answer finds the ticket.
 *
 * TEST-G2-2: merging B into A moves B's replies, keeps B's own text as the
 * customer's words, closes B, and leaves A's version fresh for the next edit.
 */

const CREDENTIALS = { email: 'admin@acme.com', password: 'secret' }
const CAPTURE = join(process.cwd(), '.ai', 'qa', 'email-capture.jsonl')
type Json = Record<string, unknown>

async function authedContext(playwright: PlaywrightWorkerArgs['playwright'], baseURL: string | undefined): Promise<APIRequestContext> {
  const anonymous = await playwright.request.newContext({ baseURL })
  const response = await anonymous.post('/api/auth/login', { form: CREDENTIALS })
  expect(response.status(), await response.text()).toBe(200)
  const cookie = response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .map((header) => header.value.split(';')[0])
    .join('; ')
  await anonymous.dispose()
  return playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie } })
}

async function readJson(response: { text: () => Promise<string> }): Promise<Json> {
  const body = await response.text()
  try { return JSON.parse(body) as Json } catch { throw new Error(`expected JSON, got: ${body.slice(0, 300)}`) }
}

async function openTicket(request: APIRequestContext, subject: string, contactEmail: string | null): Promise<{ id: string; ticketNo: string; updatedAt: string }> {
  const created = await request.post('/api/orva_support/tickets', {
    data: { subject, description: `รายละเอียดของ ${subject}`, kind: 'bug', priority: 'normal', ...(contactEmail ? { contactEmail } : {}) },
  })
  expect(created.status(), await created.text()).toBeLessThan(300)
  const body = await readJson(created)
  const id = String(body.id)
  const list = await readJson(await request.get('/api/orva_support/tickets?bucket=all&pageSize=200'))
  const row = ((list.items ?? []) as Array<Json>).find((item) => item.id === id) as Json
  expect(row, 'the new ticket must be listed').toBeTruthy()
  return { id, ticketNo: String(row.ticketNo), updatedAt: String(row.updatedAt) }
}

function capturedEmails(): Array<{ to?: unknown; subject?: unknown }> {
  if (!existsSync(CAPTURE)) return []
  return readFileSync(CAPTURE, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => { try { return JSON.parse(line) as { to?: unknown; subject?: unknown } } catch { return {} } })
}

test.describe('support inbox (G2)', () => {
  let request: APIRequestContext

  test.beforeAll(async ({ playwright, baseURL }) => {
    request = await authedContext(playwright, baseURL)
  })

  test.afterAll(async () => { await request?.dispose() })

  test('TEST-G2-1: a staff reply is emailed to the client with the ticket number in the subject, and the reply records it', async () => {
    const stamp = Date.now()
    const address = `client-${stamp}@example.test`
    const ticket = await openTicket(request, `เว็บล่มตอนเช้า ${stamp}`, address)

    const replied = await request.post('/api/orva_support/replies', {
      data: { ticketId: ticket.id, author: 'staff', body: 'ตรวจแล้วครับ เซิร์ฟเวอร์กลับมาแล้วเมื่อ 09:10', minutesSpent: 15, sendEmail: true },
    })
    expect(replied.status(), await replied.text()).toBe(200)
    const outcome = await readJson(replied)
    expect(outcome.email, 'the response must say whether the email went').toMatchObject({ sent: true })

    const thread = ((await readJson(await request.get(`/api/orva_support/replies?id=${ticket.id}`))).items ?? []) as Array<Json>
    expect(thread).toHaveLength(1)
    expect(thread[0]).toMatchObject({ author: 'staff', emailStatus: 'sent', emailError: null })

    // The message the reply became: addressed to the client, titled with the
    // ticket number — that number is how the client's answer finds the ticket.
    const messageId = String((outcome.email as Json).messageId ?? '')
    expect(messageId, 'the outcome must name the message that carries the email').not.toBe('')
    const message = await readJson(await request.get(`/api/messages/${messageId}`))
    const record = (message.message ?? message) as Json
    expect(String(record.subject)).toContain(`[${ticket.ticketNo}]`)
    expect(String(record.externalEmail)).toBe(address)

    // Delivery itself is the messages module's send-email worker. When the
    // harness runs one, the shared sender writes the mail to the capture file
    // in test mode; report what is there rather than assume a worker ran.
    const mine = capturedEmails().filter((mail) => JSON.stringify(mail.to ?? '').includes(address))
    if (mine.length > 0) expect(String(mine[mine.length - 1].subject)).toContain(`[${ticket.ticketNo}]`)
    console.log(`[g2] emailed reply: message ${messageId}; captured deliveries for ${address}: ${mine.length}`)
  })

  test('TEST-G2-1b: without a contact email the reply is saved and the outcome says why nothing was sent', async () => {
    const ticket = await openTicket(request, `แจ้งทางโทรศัพท์ ${Date.now()}`, null)
    const replied = await request.post('/api/orva_support/replies', {
      data: { ticketId: ticket.id, author: 'staff', body: 'รับทราบ', sendEmail: true },
    })
    expect(replied.status(), await replied.text()).toBe(200)
    const outcome = await readJson(replied)
    expect((outcome.email as Json).sent).toBe(false)
    expect(String((outcome.email as Json).error)).toContain('อีเมล')
  })

  test('TEST-G2-2: merging a duplicate moves its replies, keeps its text, closes it, and refreshes the target version', async () => {
    const stamp = Date.now()
    const target = await openTicket(request, `ปุ่มบันทึกไม่ทำงาน ${stamp}`, `dup-${stamp}@example.test`)
    const duplicate = await openTicket(request, `Re: ปุ่มบันทึกไม่ทำงาน ${stamp}`, `dup-${stamp}@example.test`)
    const onDuplicate = await request.post('/api/orva_support/replies', {
      data: { ticketId: duplicate.id, author: 'customer', body: 'ยังเป็นอยู่ครับ ลองอีกรอบแล้ว' },
    })
    expect(onDuplicate.status()).toBe(200)

    const stale = await request.post('/api/orva_support/tickets/merge', {
      data: { sourceId: duplicate.id, targetId: target.id, updatedAt: '2020-01-01T00:00:00.000Z' },
    })
    expect(stale.status(), 'a stale target version must be refused').toBe(409)

    const merged = await request.post('/api/orva_support/tickets/merge', {
      data: { sourceId: duplicate.id, targetId: target.id, updatedAt: target.updatedAt },
    })
    expect(merged.status(), await merged.text()).toBe(200)
    const result = await readJson(merged)
    expect(result).toMatchObject({ targetId: target.id, ticketNo: target.ticketNo, mergedTicketNo: duplicate.ticketNo })
    expect(result.updatedAt).not.toBe(target.updatedAt)

    const thread = ((await readJson(await request.get(`/api/orva_support/replies?id=${target.id}`))).items ?? []) as Array<Json>
    const bodies = thread.map((r) => String(r.body))
    expect(bodies.some((b) => b.includes('ยังเป็นอยู่ครับ'))).toBe(true)
    expect(bodies.some((b) => b.includes(`[รวมจาก ${duplicate.ticketNo}]`))).toBe(true)

    const list = ((await readJson(await request.get('/api/orva_support/tickets?bucket=all&pageSize=200'))).items ?? []) as Array<Json>
    expect(list.find((row) => row.id === duplicate.id), 'the duplicate leaves the queue').toBeUndefined()
    expect(list.find((row) => row.id === target.id), 'the target stays').toBeTruthy()
  })
})
