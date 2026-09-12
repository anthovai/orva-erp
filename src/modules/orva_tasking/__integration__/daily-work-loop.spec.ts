import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'

/**
 * The board, which is the thing the owner actually touches all day.
 *
 * Sixteen routes and nine tables carry the daily work, and until now one
 * spec covered one of them. These are the four invariants whose failure
 * would be expensive and quiet:
 *
 *   1. **Dropping a card in the done column is what marks work finished.**
 *      Nothing else in the system re-derives it. งาน% comes from `done`, and
 *      the home screen turns งาน% against เรียกเก็บ% into "this much has been
 *      earned and not billed" — the 59,920 baht the owner is now shown. A
 *      drag that fails to tick, or a card dragged back out that stays ticked,
 *      makes that number wrong in the direction nobody checks.
 *   2. **Deleting a column must not delete the cards in it.** The route says
 *      it moves them to the first remaining column, and the operator presses
 *      it while tidying a board — the moment they are least braced for losing
 *      work.
 *   3. **A sub-task loop must be refused.** A cycle in the relation graph is
 *      the sort of thing that renders once and then hangs a screen forever.
 *   4. **An internal note never reaches the customer.** Team notes and the
 *      customer's own thread live in the same table, separated by one
 *      boolean that is off by default. This is the only invariant here whose
 *      failure costs a relationship rather than a number.
 *
 * Harness fixtures in an ephemeral database; the session cookie is carried
 * explicitly because the ephemeral app is a production build.
 */

const CREDENTIALS = { email: 'admin@acme.com', password: 'secret' }
type Json = Record<string, unknown>

async function login(playwright: PlaywrightWorkerArgs['playwright'], baseURL: string | undefined): Promise<APIRequestContext> {
  const anonymous = await playwright.request.newContext({ baseURL })
  const response = await anonymous.post('/api/auth/login', { form: CREDENTIALS })
  expect(response.status(), await response.text()).toBe(200)
  const cookie = response.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value.split(';')[0]).join('; ')
  await anonymous.dispose()
  return playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie } })
}

/** A signed-in customer's own context; the portal login needs the org named. */
async function customerLogin(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string | undefined,
  email: string,
  password: string,
  organizationId: string,
): Promise<APIRequestContext> {
  const anonymous = await playwright.request.newContext({ baseURL })
  const response = await anonymous.post('/api/customer_accounts/login', { data: { email, password, organizationId } })
  expect(response.status(), await response.text()).toBeLessThan(300)
  const cookie = response.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value.split(';')[0]).join('; ')
  // A login that answers 200 and sets no cookie leaves every later call 401,
  // which reads as "the portal refused you" rather than "you never signed in".
  expect(cookie, `login returned no cookie: ${await response.text()}`).not.toBe('')
  await anonymous.dispose()
  return playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie } })
}

async function readJson(response: { text: () => Promise<string>; status: () => number }): Promise<Json> {
  const body = await response.text()
  try { return JSON.parse(body) as Json } catch {
    throw new Error(`expected JSON, got ${response.status()}: ${body.slice(0, 300) || '(empty body)'}`)
  }
}
const idOf = (body: Json): string => (typeof body.id === 'string' ? body.id : String((body.item as Json | undefined)?.id ?? ''))
const items = (body: Json): Array<Json> => (body.items ?? []) as Array<Json>

async function post(request: APIRequestContext, url: string, data: Json) {
  const res = await request.post(url, { data })
  return { status: res.status(), body: await readJson(res) }
}

async function put(request: APIRequestContext, url: string, data: Json) {
  const res = await request.put(url, { data })
  return { status: res.status(), body: await readJson(res) }
}

/** Drag a card: the move route is a PUT, because it edits a card in place. */
async function move(request: APIRequestContext, id: string, bucketId: string, updatedAt: unknown) {
  return put(request, '/api/orva_tasking/tasks/position', { id, bucketId, index: 0, updatedAt: String(updatedAt) })
}

/** A project with a three-column board and `count` cards in the first column. */
async function board(request: APIRequestContext, stamp: string, count: number, quoteId?: string) {
  const project = await post(request, '/api/orva_tasking/projects', {
    name: `กระดานงาน ${stamp}`, ...(quoteId ? { quoteId } : {}),
  })
  expect(project.status, JSON.stringify(project.body)).toBeLessThan(300)
  const projectId = idOf(project.body)

  const columns = await post(request, '/api/orva_tasking/buckets/defaults', {
    projectId, titles: ['รอทำ', 'กำลังทำ', 'เสร็จ'],
  })
  expect(columns.status, JSON.stringify(columns.body)).toBeLessThan(300)

  const taskIds: string[] = []
  for (let i = 0; i < count; i++) {
    const task = await post(request, '/api/orva_tasking/tasks', { projectId, title: `งาน ${i + 1} ${stamp}` })
    expect(task.status, JSON.stringify(task.body)).toBeLessThan(300)
    taskIds.push(idOf(task.body))
  }
  return { projectId, taskIds }
}

async function columnsOf(request: APIRequestContext, projectId: string): Promise<Array<Json>> {
  const res = await request.get(`/api/orva_tasking/buckets?projectId=${projectId}`)
  expect(res.status(), await res.text()).toBe(200)
  return items(await readJson(res))
}

async function tasksOf(request: APIRequestContext, projectId: string): Promise<Array<Json>> {
  const res = await request.get(`/api/orva_tasking/tasks?projectId=${projectId}&bucket=all`)
  expect(res.status(), await res.text()).toBe(200)
  return items(await readJson(res))
}

const taskById = (rows: Array<Json>, id: string): Json | undefined => rows.find((row) => row.id === id)

test.describe('the board is what says the work is done', () => {
  let request: APIRequestContext

  test.beforeAll(async ({ playwright, baseURL }) => { request = await login(playwright, baseURL) })
  test.afterAll(async () => { await request.dispose() })

  test('a card dropped in the done column is finished, and reopens when dragged back out', async () => {
    test.setTimeout(120_000)
    const stamp = Date.now().toString(36)
    const { projectId, taskIds } = await board(request, stamp, 2)

    const columns = await columnsOf(request, projectId)
    expect(columns.map((c) => c.title)).toEqual(['รอทำ', 'กำลังทำ', 'เสร็จ'])
    const done = columns.find((c) => c.isDoneBucket)
    const first = columns[0]
    expect(done, 'the last default column is the done column').toBeTruthy()
    expect(done!.id).toBe(columns[2].id)

    const before = taskById(await tasksOf(request, projectId), taskIds[0])
    expect(before!.done).toBe(false)

    const dropped = await move(request, taskIds[0], String(done!.id), before!.updatedAt)
    expect(dropped.status, JSON.stringify(dropped.body)).toBe(200)
    expect(dropped.body.done, 'the done column ticks the card').toBe(true)

    const ticked = taskById(await tasksOf(request, projectId), taskIds[0])
    expect(ticked!.done).toBe(true)
    expect(ticked!.doneAt, 'a finished card records when').toBeTruthy()

    // Dragged back out: reopened, and the stamp cleared — a card that still
    // claimed a doneAt would keep counting as delivered work.
    const back = await move(request, taskIds[0], String(first.id), ticked!.updatedAt)
    expect(back.status, JSON.stringify(back.body)).toBe(200)
    expect(back.body.done).toBe(false)

    const reopened = taskById(await tasksOf(request, projectId), taskIds[0])
    expect(reopened!.done).toBe(false)
    expect(reopened!.doneAt ?? null, 'reopening clears the stamp').toBeNull()

    // The other card never moved and must be untouched by any of it.
    expect(taskById(await tasksOf(request, projectId), taskIds[1])!.done).toBe(false)
  })

  test('a board can only have one done column', async () => {
    test.setTimeout(120_000)
    const stamp = Date.now().toString(36)
    const { projectId } = await board(request, stamp, 0)

    const second = await post(request, '/api/orva_tasking/buckets', {
      projectId, title: `เสร็จอีกอัน ${stamp}`, isDoneBucket: true,
    })
    expect(second.status, 'a second done column would make "finished" ambiguous').toBe(409)

    // Editing a column's flag MOVES it rather than adding a second one — the
    // route says "move the done flag", and a swap is the only way to change
    // which column finishes work without leaving the board briefly ambiguous.
    const columns = await columnsOf(request, projectId)
    const wasDone = columns.find((c) => c.isDoneBucket)!
    const notDone = columns.find((c) => !c.isDoneBucket)!
    const flagged = await put(request, '/api/orva_tasking/buckets', {
      id: notDone.id, isDoneBucket: true, updatedAt: String(notDone.updatedAt),
    })
    expect(flagged.status, JSON.stringify(flagged.body)).toBe(200)

    const after = await columnsOf(request, projectId)
    expect(after.filter((c) => c.isDoneBucket), 'still exactly one').toHaveLength(1)
    expect(after.find((c) => c.isDoneBucket)!.id).toBe(notDone.id)
    expect(after.find((c) => c.id === wasDone.id)!.isDoneBucket, 'the old one gave it up').toBe(false)
  })

  test('deleting a column moves its cards out instead of taking them with it', async () => {
    test.setTimeout(120_000)
    const stamp = Date.now().toString(36)
    const { projectId, taskIds } = await board(request, stamp, 3)

    const columns = await columnsOf(request, projectId)
    const middle = columns[1]

    // Park two cards in the middle column, then delete it.
    for (const id of taskIds.slice(0, 2)) {
      const current = taskById(await tasksOf(request, projectId), id)!
      const moved = await move(request, id, String(middle.id), current.updatedAt)
      expect(moved.status, JSON.stringify(moved.body)).toBe(200)
    }

    const removed = await request.delete('/api/orva_tasking/buckets', { data: { id: middle.id } })
    expect(removed.status(), await removed.text()).toBe(200)
    const result = await readJson(removed)
    expect(result.movedCount, 'both parked cards were carried over').toBe(2)
    // `movedTo` is the column's TITLE, not its id — the operator is told
    // "moved to รอทำ", so the answer is written for them, not for a client.
    expect(result.movedTo).toBe(columns[0].title)

    // Nothing was lost: all three cards are still on the board, and the two
    // that were parked are now genuinely in the first column rather than
    // merely still existing with a dangling bucket.
    const after = await tasksOf(request, projectId)
    expect(after.filter((row) => taskIds.includes(String(row.id)))).toHaveLength(3)
    for (const id of taskIds.slice(0, 2)) {
      expect(taskById(after, id)!.bucketId, `${id} landed in the first column`).toBe(columns[0].id)
    }
    expect((await columnsOf(request, projectId)).map((c) => c.id)).toEqual([columns[0].id, columns[2].id])
  })

  test('the last column cannot be deleted — a board with no columns holds no cards', async () => {
    test.setTimeout(120_000)
    const stamp = Date.now().toString(36)
    const { projectId } = await board(request, stamp, 1)

    const columns = await columnsOf(request, projectId)
    for (const column of columns.slice(1)) {
      const res = await request.delete('/api/orva_tasking/buckets', { data: { id: column.id } })
      expect(res.status(), await res.text()).toBe(200)
    }
    const [last] = await columnsOf(request, projectId)
    const refused = await request.delete('/api/orva_tasking/buckets', { data: { id: last.id } })
    expect(refused.status(), 'the last column must stay').toBe(409)
    expect(await columnsOf(request, projectId)).toHaveLength(1)
  })

  test('a sub-task cannot become its own parent', async () => {
    test.setTimeout(120_000)
    const stamp = Date.now().toString(36)
    const { projectId, taskIds } = await board(request, stamp, 3)
    const [a, b, c] = taskIds

    expect((await post(request, '/api/orva_tasking/relations', { taskId: a, otherTaskId: b, kind: 'subtask' })).status).toBe(200)
    expect((await post(request, '/api/orva_tasking/relations', { taskId: b, otherTaskId: c, kind: 'subtask' })).status).toBe(200)

    // Closing the loop, directly and at one remove.
    const direct = await post(request, '/api/orva_tasking/relations', { taskId: b, otherTaskId: a, kind: 'subtask' })
    expect(direct.status, 'b is already under a').toBe(409)
    const indirect = await post(request, '/api/orva_tasking/relations', { taskId: c, otherTaskId: a, kind: 'subtask' })
    expect(indirect.status, 'a → b → c → a is a cycle').toBe(409)

    // Unlinking works from the far end, because the inverse row is written too.
    const unlinked = await request.delete('/api/orva_tasking/relations', { data: { taskId: b, otherTaskId: a } })
    expect(unlinked.status(), await unlinked.text()).toBe(200)
    const relinked = await post(request, '/api/orva_tasking/relations', { taskId: b, otherTaskId: a, kind: 'subtask' })
    expect(relinked.status, 'with the link gone the other direction is free').toBe(200)

    expect(projectId).toBeTruthy()
  })
})

test.describe('an internal note never leaves the building', () => {
  let request: APIRequestContext

  test.beforeAll(async ({ playwright, baseURL }) => { request = await login(playwright, baseURL) })
  test.afterAll(async () => { await request.dispose() })

  test('the customer reads the published project, the visible note, and nothing else', async ({ playwright, baseURL }) => {
    test.setTimeout(180_000)
    const stamp = Date.now().toString(36)

    const switcher = await readJson(await request.get('/api/directory/organization-switcher'))
    const organizationId = String((items(switcher)[0] ?? {}).id ?? (switcher.organizationId ?? ''))
    expect(organizationId, 'the portal login needs the organisation named').not.toBe('')

    const company = await post(request, '/api/customers/companies', { displayName: `ลูกค้ากระดาน ${stamp}` })
    expect(company.status, JSON.stringify(company.body)).toBeLessThan(300)
    const customerEntityId = idOf(company.body)

    const quote = await post(request, '/api/sales/quotes', {
      currencyCode: 'THB', customerEntityId,
      lines: [{ name: `งานเว็บ ${stamp}`, currencyCode: 'THB', quantity: 1, unitPriceNet: 50000, taxRate: 7 }],
    })
    expect(quote.status, JSON.stringify(quote.body)).toBeLessThan(300)
    const quoteId = idOf(quote.body)

    const { projectId, taskIds } = await board(request, stamp, 1, quoteId)

    const secret = 'ลูกค้าติดต่อยาก อย่าส่งให้ดู'
    const shared = 'ทีมกำลังทำหน้าแรกอยู่ครับ'
    expect((await post(request, '/api/orva_tasking/comments', { taskId: taskIds[0], body: secret })).status).toBe(200)
    expect((await post(request, '/api/orva_tasking/comments', {
      taskId: taskIds[0], body: shared, isCustomerVisible: true,
    })).status).toBe(200)

    // Staff see both, which is what makes the portal's shorter list meaningful.
    const staffSide = items(await readJson(await request.get(`/api/orva_tasking/comments?taskId=${taskIds[0]}`)))
    expect(staffSide.map((row) => String(row.body))).toEqual(expect.arrayContaining([secret, shared]))

    const listed = (await readJson(await request.get(`/api/orva_tasking/projects?id=${projectId}`)))
    const project = (items(listed).find((row) => row.id === projectId) ?? listed) as Json
    const published = await post(request, '/api/orva_tasking/projects/publish', {
      id: projectId, visible: true, updatedAt: String(project.updatedAt),
    })
    expect(published.status, JSON.stringify(published.body)).toBe(200)

    // The account needs a ROLE CARRYING THE FEATURE, not just a customer link.
    //
    // This cost three runs to pin down and is worth writing out. The work
    // portal gates on `orva_tasking.portal.view`; features reach a customer
    // only through a customer role's ACL; and the seeded roles carry none of
    // this module's features. `orva_tasking/setup.ts` does declare
    // `defaultCustomerRoleFeatures` for portal_admin, buyer and viewer, and
    // `customer_accounts.seedDefaults` does merge them — but only when it is
    // re-run after this module was added, and its call site swallows every
    // error. Checked on the real tenant while writing this: buyer, viewer and
    // portal_admin between them hold zero `orva_*` features, so a customer
    // linked today would meet 403 on this page while their invoices load
    // normally (the billing portal gates on the customer link alone).
    //
    // So the fixture grants it explicitly rather than assuming the
    // environment did. Assuming it is what made the first three runs report
    // an empty comment list instead of a locked door.
    const roleSlug = `orva-board-${stamp}`
    const role = await post(request, '/api/customer_accounts/admin/roles', {
      name: `พอร์ทัลงาน ${stamp}`, slug: roleSlug, customerAssignable: true,
    })
    expect(role.status, JSON.stringify(role.body)).toBeLessThan(300)
    // This route answers `{ ok, role: { id } }`, not `{ id }` — the shared
    // `idOf` helper reads neither and returns '', which then sailed through
    // two more calls and surfaced three steps later as an unexplained 401.
    // Hence the explicit shape, and the assertion that it really is an id.
    const roleId = String((role.body.role as Json | undefined)?.id ?? '')
    expect(roleId, `no role id in ${JSON.stringify(role.body)}`).toMatch(/^[0-9a-f-]{36}$/i)

    const acl = await request.put(`/api/customer_accounts/admin/roles/${roleId}/acl`, {
      data: { features: ['orva_tasking.portal.view', 'orva_tasking.portal.comment'] },
    })
    expect(acl.status(), await acl.text()).toBe(200)

    const password = `Board!${stamp}aA1`
    const account = await request.post('/api/customer_accounts/admin/users', {
      data: {
        email: `board-${stamp}@example.test`, password, displayName: `คุณลูกค้า ${stamp}`,
        customerEntityId, roleIds: [roleId],
      },
    })
    expect(account.status(), await account.text()).toBeLessThan(300)

    const customer = await customerLogin(playwright, baseURL, `board-${stamp}@example.test`, password, organizationId)
    try {
      const portal = await customer.get(`/api/orva_tasking/portal/projects/${projectId}`)
      // Asserted before anything is read out of it: an error body has no
      // `comments`, and `?? []` would then quietly report "no notes" — the
      // exact shape `src/lib/__tests__/swallowedDatabaseErrors.test.ts` exists
      // to stop, which is no more acceptable in a test than in a route.
      expect(portal.status(), await portal.text()).toBe(200)
      const seen = await readJson(portal)
      expect(((seen.tasks ?? []) as Array<Json>).map((row) => String(row.id)), 'the task itself reaches the customer')
        .toContain(taskIds[0])
      const bodies = ((seen.comments ?? []) as Array<Json>).map((row) => String(row.body))
      expect(bodies, 'the note meant for the customer arrives').toContain(shared)
      expect(bodies, 'the internal note does not').not.toContain(secret)

      // Unpublished again, the whole project goes away rather than emptying.
      const reread = items(await readJson(await request.get(`/api/orva_tasking/projects?id=${projectId}`)))
        .find((row) => row.id === projectId) as Json
      const hidden = await post(request, '/api/orva_tasking/projects/publish', {
        id: projectId, visible: false, updatedAt: String(reread.updatedAt),
      })
      expect(hidden.status, JSON.stringify(hidden.body)).toBe(200)
      expect((await customer.get(`/api/orva_tasking/portal/projects/${projectId}`)).status()).toBe(404)
    } finally {
      await customer.dispose()
    }
  })
})
