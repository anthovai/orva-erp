import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  authedContext,
  ensureAccountId,
  readJson,
} from '../../orva_purchasing/__integration__/fixtures'

/**
 * The vendor registry, and the moment it decides whether money may be spent.
 *
 * `orva_party` is the one concept upstream lacks: a neutral party holding
 * business roles. In practice it is the vendor list, and it is load-bearing —
 * purchase orders, AP bills, AP payments and expenses each reference a party
 * by bare uuid and ask the same question first: **does this party hold an
 * active vendor role, here?** `assertVendorRole` asks it on every write and
 * not only at create, so a role revoked between drafting and sending stops
 * the send.
 *
 * Three tables and three routes carried that with no end-to-end coverage at
 * all. Proved here is the lifecycle a real vendor goes through:
 *
 *   - a party that is not a vendor cannot be ordered from,
 *   - granting the role opens the door and revoking it closes it, while the
 *     order already placed is history and stays,
 *   - a revoked vendor can be reinstated — the unique index is partial for
 *     exactly that reason, and a registry that could never take a vendor back
 *     is one you end up working around,
 *   - the same role cannot be held twice at once, and now says so instead of
 *     answering 500,
 *   - and neither route that accepts a `partyId` in its body will act on one
 *     the caller cannot see.
 *
 * The fixtures come from `orva_purchasing` because a purchase order is the
 * cheapest real write that calls `assertVendorRole`, and the ephemeral tenant
 * has no chart of accounts until something creates one.
 */

type Json = Record<string, unknown>

const idOf = (body: Json): string => (typeof body.id === 'string' ? body.id : String((body.item as Json | undefined)?.id ?? ''))
const items = (body: Json): Array<Json> => (body.items ?? []) as Array<Json>

async function post(request: APIRequestContext, url: string, data: Json) {
  const res = await request.post(url, { data })
  return { status: res.status(), body: await readJson(res) }
}

/** A party in the registry holding no roles yet — deliberately not a vendor. */
async function party(request: APIRequestContext, name: string): Promise<string> {
  const created = await post(request, '/api/orva_party/parties', {
    kind: 'company', displayName: name, taxId: '0105500000002',
  })
  expect(created.status, JSON.stringify(created.body)).toBeLessThan(300)
  const id = idOf(created.body)
  expect(id, `no party id in ${JSON.stringify(created.body)}`).toMatch(/^[0-9a-f-]{36}$/i)
  return id
}

const grantVendor = (request: APIRequestContext, partyId: string) =>
  post(request, '/api/orva_party/party-roles', { partyId, role: 'vendor' })

async function activeVendorRole(request: APIRequestContext, partyId: string): Promise<Json | undefined> {
  const res = await request.get(`/api/orva_party/party-roles?partyId=${partyId}`)
  expect(res.status(), await res.text()).toBe(200)
  return items(await readJson(res)).find((row) => row.role === 'vendor')
}

async function orderFrom(request: APIRequestContext, partyId: string, accountId: string, what: string) {
  return post(request, '/api/orva_purchasing/orders', {
    vendorPartyId: partyId,
    orderDate: new Date().toISOString().slice(0, 10),
    lines: [{ kind: 'service', description: what, quantity: 2, unitPrice: 1500, vatMode: '7', accountId }],
  })
}

test.describe('a party may be ordered from only while it is a vendor', () => {
  let request: APIRequestContext
  let accountId: string

  test.beforeAll(async ({ playwright, baseURL }) => {
    request = await authedContext(playwright, baseURL)
    accountId = await ensureAccountId(request)
  })
  test.afterAll(async () => { await request.dispose() })

  test('the role is the door: granting opens it, revoking closes it, and it reopens', async () => {
    test.setTimeout(180_000)
    const stamp = Date.now().toString(36)
    const partyId = await party(request, `ห้างหุ้นส่วนวงจร ${stamp}`)

    // In the registry but not a vendor. The refusal has to name the fix,
    // because the operator's next move is to go and add the role.
    const beforeRole = await orderFrom(request, partyId, accountId, `บริการที่ปรึกษา ${stamp}`)
    expect(beforeRole.status, JSON.stringify(beforeRole.body)).toBe(400)
    expect(String(beforeRole.body.error ?? ''), 'the message points at the registry').toContain('ผู้ขาย')

    expect((await grantVendor(request, partyId)).status).toBeLessThan(300)

    const opened = await orderFrom(request, partyId, accountId, `บริการที่ปรึกษา ${stamp}`)
    expect(opened.status, JSON.stringify(opened.body)).toBeLessThan(300)
    const orderId = idOf(opened.body)
    expect(orderId).toMatch(/^[0-9a-f-]{36}$/i)

    // Revoked. What must stop is placing a NEW order; the one already placed
    // is a commitment that was made and does not un-make itself.
    const role = await activeVendorRole(request, partyId)
    expect(role, 'the granted role is listed as active').toBeTruthy()
    const revoked = await request.delete('/api/orva_party/party-roles', { data: { id: role!.id } })
    expect(revoked.status(), await revoked.text()).toBeLessThan(300)
    expect(await activeVendorRole(request, partyId), 'a revoked role leaves the active list').toBeUndefined()

    const afterRevoke = await orderFrom(request, partyId, accountId, `บริการที่ปรึกษา ${stamp}`)
    expect(afterRevoke.status, 'an ex-vendor cannot be ordered from').toBe(400)

    const existing = await request.get(`/api/orva_purchasing/orders/${orderId}`)
    expect(existing.status(), 'the order already placed is untouched').toBe(200)

    // Reinstated: the partial unique index exists so a vendor can come back.
    expect((await grantVendor(request, partyId)).status).toBeLessThan(300)
    const reopened = await orderFrom(request, partyId, accountId, `บริการที่ปรึกษา ${stamp}`)
    expect(reopened.status, 'a reinstated vendor can be ordered from again').toBeLessThan(300)
  })

  test('the same role cannot be held twice, and says so rather than failing', async () => {
    test.setTimeout(120_000)
    const stamp = Date.now().toString(36)
    const partyId = await party(request, `ห้างหุ้นส่วนซ้ำ ${stamp}`)

    expect((await grantVendor(request, partyId)).status).toBeLessThan(300)

    // `orva_party_roles_active_unique` has always refused this in the
    // database, but a raw unique violation is not a CrudHttpError and the
    // CRUD factory maps what it does not recognise to a bare 500 — so
    // registering a vendor that was already a vendor read as the server
    // breaking. Same refusal, said out loud.
    const twice = await grantVendor(request, partyId)
    expect(twice.status, JSON.stringify(twice.body)).toBe(409)
    expect(String(twice.body.error ?? '')).toContain('บทบาท')

    const listed = await readJson(await request.get(`/api/orva_party/party-roles?partyId=${partyId}`))
    expect(items(listed).filter((row) => row.role === 'vendor'), 'still exactly one').toHaveLength(1)
  })

  test('a party the caller cannot see is refused, on both routes that take one in the body', async () => {
    test.setTimeout(120_000)
    const stamp = Date.now().toString(36)
    // A well-formed uuid naming nothing. A party belonging to another
    // organization has to get this same answer: telling the two apart would
    // confirm the id names something real.
    const stranger = '00000000-0000-4000-8000-00000000dead'
    const target = '00000000-0000-4000-8000-00000000beef'

    const role = await post(request, '/api/orva_party/party-roles', { partyId: stranger, role: 'vendor' })
    expect(role.status, JSON.stringify(role.body)).toBe(400)

    const link = await post(request, '/api/orva_party/party-links', {
      partyId: stranger, targetEntity: 'customers:customer_entity', targetId: target,
    })
    expect(link.status, JSON.stringify(link.body)).toBe(400)

    // …and the caller's own party still works through both, so the guard
    // refuses the stranger rather than simply refusing everything.
    const mine = await party(request, `ห้างหุ้นส่วนของเรา ${stamp}`)
    expect((await grantVendor(request, mine)).status).toBeLessThan(300)
    const ok = await post(request, '/api/orva_party/party-links', {
      partyId: mine, targetEntity: 'customers:customer_entity', targetId: target,
    })
    expect(ok.status, JSON.stringify(ok.body)).toBeLessThan(300)
  })
})
