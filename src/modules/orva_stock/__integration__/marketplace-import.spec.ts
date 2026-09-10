import { expect, test, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test'

/**
 * H1 — a marketplace order file becomes retail sales, once.
 *
 * Seeds a site, a SKU with a received lot, then uploads a small Shopee-shaped
 * CSV with three orders: one completed (→ a sale), one cancelled (→ skipped),
 * one for a SKU the catalog does not have (→ skipped with the SKU named). The
 * import writes the sale and the log; the same file uploaded again previews
 * the sold order as "already imported" and the import skips it. The product's
 * reorder point (H1a) is set so the sale takes the SKU below it and the
 * valuation page's `lowStock` names it.
 *
 * Harness fixtures in an ephemeral database; the session cookie is carried
 * explicitly because the ephemeral app is a production build.
 */

const CREDENTIALS = { email: 'admin@acme.com', password: 'secret' }
type Json = Record<string, unknown>

async function authedContext(playwright: PlaywrightWorkerArgs['playwright'], baseURL: string | undefined): Promise<APIRequestContext> {
  const anonymous = await playwright.request.newContext({ baseURL })
  const response = await anonymous.post('/api/auth/login', { form: CREDENTIALS })
  expect(response.status(), await response.text()).toBe(200)
  const cookie = response.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value.split(';')[0]).join('; ')
  await anonymous.dispose()
  return playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie } })
}

async function readJson(response: { text: () => Promise<string> }): Promise<Json> {
  const body = await response.text()
  try { return JSON.parse(body) as Json } catch { throw new Error(`expected JSON, got: ${body.slice(0, 300)}`) }
}
const idOf = (body: Json, ...keys: string[]): string => {
  for (const key of ['id', ...keys]) { const v = body[key]; if (typeof v === 'string' && v) return v }
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

/** Warehouse + bin + the GL accounts stock and sales need, and stock settings pointing at them. */
async function ensureSite(request: APIRequestContext): Promise<void> {
  const settings = await readJson(await request.get('/api/orva_stock/settings'))
  const current = (settings.settings ?? settings) as Json
  if (current.warehouseId && current.locationId && current.inventoryAccountId && current.cogsAccountId) return
  const stamp = Date.now().toString(36).toUpperCase()
  const warehouse = await request.post('/api/wms/warehouses', { data: { name: `คลัง (import ${stamp})`, code: `IMP-${stamp}`, isActive: true, isPrimary: true } })
  expect(warehouse.status(), await warehouse.text()).toBeLessThan(300)
  const warehouseId = idOf(await readJson(warehouse), 'warehouseId')
  const location = await request.post('/api/wms/locations', { data: { warehouseId, code: 'A-01', type: 'bin', isActive: true } })
  expect(location.status(), await location.text()).toBeLessThan(300)
  const locationId = idOf(await readJson(location), 'locationId')
  const inventoryAccountId = await ensureAccount(request, '1200', 'สินค้าคงเหลือ', 'asset')
  const cogsAccountId = await ensureAccount(request, '5010', 'ต้นทุนขายสินค้า', 'expense')
  await ensureAccount(request, '1020', 'ธนาคารกสิกรไทย', 'asset')
  const put = await request.put('/api/orva_stock/settings', { data: { inventoryAccountId, cogsAccountId, warehouseId, locationId } })
  expect(put.status(), await put.text()).toBeLessThan(300)
}

/** AR settings so the retail sale's payment can be booked (bank + receivable + output VAT). */
async function ensureArSettings(request: APIRequestContext): Promise<void> {
  const existing = await readJson(await request.get('/api/orva_finance/ar/settings'))
  if (existing.arAccountId && existing.defaultCashAccountId) return
  const arAccountId = await ensureAccount(request, '1100', 'ลูกหนี้การค้า', 'asset')
  const cash = await ensureAccount(request, '1020', 'ธนาคารกสิกรไทย', 'asset')
  const revenue = await ensureAccount(request, '4000', 'รายได้จากการขาย', 'income')
  const outputVat = await ensureAccount(request, '2300', 'ภาษีขาย', 'liability')
  const wht = await ensureAccount(request, '1400', 'ภาษีถูกหัก ณ ที่จ่าย', 'asset')
  const put = await request.put('/api/orva_finance/ar/settings', {
    data: { arAccountId, revenueAccountId: revenue, taxAccountId: outputVat, whtReceivableAccountId: wht, defaultCashAccountId: cash },
  })
  expect(put.status(), await put.text()).toBeLessThan(300)
  const periods = await readJson(await request.get('/api/orva_finance/gl/periods?page=1&pageSize=100'))
  const month = new Date().toISOString().slice(0, 7)
  if (!((periods.items ?? []) as Array<{ code: string }>).some((p) => p.code === month)) {
    const [y, m] = month.split('-').map(Number)
    await request.post('/api/orva_finance/gl/periods', { data: { code: month, startsOn: `${month}-01`, endsOn: `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` } })
  }
}

async function createSku(request: APIRequestContext, reorderPoint: number): Promise<{ variantId: string; sku: string }> {
  const stamp = Date.now().toString(36).toUpperCase()
  const product = await request.post('/api/catalog/products', {
    data: { title: `Marventine Body Lotion (import ${stamp})`, productType: 'simple', taxRate: 7, cf_product_brand: 'MRV', cf_reorder_point: reorderPoint },
  })
  expect(product.status(), await product.text()).toBeLessThan(300)
  const productId = idOf(await readJson(product), 'productId')
  const sku = `MRV-IMP-${stamp}`
  const variants = ((await readJson(await request.get(`/api/catalog/variants?productId=${productId}&pageSize=20`))).items ?? []) as Array<Json>
  const owned = variants.find((row) => String(row.productId ?? row.product_id ?? '') === productId)
  let variantId = owned ? String(owned.id) : ''
  if (variantId) {
    const updated = await request.put('/api/catalog/variants', { data: { id: variantId, name: 'Marventine Body Lotion 200 มล.', sku, isActive: true } })
    expect(updated.status(), await updated.text()).toBeLessThan(300)
  } else {
    const created = await request.post('/api/catalog/variants', { data: { productId, name: 'Marventine Body Lotion 200 มล.', sku, isDefault: true, isActive: true } })
    expect(created.status(), await created.text()).toBeLessThan(300)
    variantId = idOf(await readJson(created), 'variantId')
  }
  return { variantId, sku }
}

const shopeeCsv = (sku: string, stamp: string) => [
  'หมายเลขคำสั่งซื้อ,สถานะการสั่งซื้อ,เลขอ้างอิง SKU (SKU Reference No.),ชื่อสินค้า,จำนวน,ราคาขาย,วันที่ทำการสั่งซื้อ,ชื่อผู้รับ',
  `SP-${stamp}-1,สำเร็จแล้ว,${sku},Marventine Body Lotion,2,"390.00",2026-09-08 10:12,คุณเอ`,
  `SP-${stamp}-2,ยกเลิกแล้ว,${sku},Marventine Body Lotion,1,"390.00",2026-09-08 11:00,คุณบี`,
  `SP-${stamp}-3,สำเร็จแล้ว,NOT-A-SKU-${stamp},อื่น ๆ,1,"100.00",2026-09-08 12:00,คุณซี`,
].join('\n')

test.describe('marketplace import (H1)', () => {
  let request: APIRequestContext

  test.beforeAll(async ({ playwright, baseURL }) => {
    request = await authedContext(playwright, baseURL)
    await ensureSite(request)
    await ensureArSettings(request)
  })

  test.afterAll(async () => { await request?.dispose() })

  test('a Shopee CSV previews, imports once, skips on re-upload, and the sale takes the SKU below its reorder point', async () => {
    test.setTimeout(180_000)
    const stamp = Date.now().toString(36).toUpperCase()
    const { variantId, sku } = await createSku(request, 5)

    // Six bottles on the shelf, costed.
    const received = await request.post('/api/orva_stock/receive', {
      data: { catalogVariantId: variantId, quantity: 6, unitCost: 120, lotNumber: `LOT-${stamp}`, receivedOn: '2026-09-01', expiresOn: '2028-09-01' },
    })
    expect(received.status(), await received.text()).toBe(200)

    const csv = shopeeCsv(sku, stamp)
    const preview = await request.post('/api/orva_stock/marketplace-import/preview', {
      multipart: { marketplace: 'shopee', mapping: '{}', priceIsLineTotal: '0', file: { name: 'Order.all.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') } },
    })
    expect(preview.status(), await preview.text()).toBe(200)
    const previewed = await readJson(preview)
    expect(previewed.mapping).toMatchObject({ orderId: 'หมายเลขคำสั่งซื้อ', sku: 'เลขอ้างอิง SKU (SKU Reference No.)', unitPrice: 'ราคาขาย' })
    const orders = previewed.orders as Array<Json>
    expect(orders.map((o) => [o.externalOrderId, o.resolution])).toEqual([
      [`SP-${stamp}-1`, 'ready'], [`SP-${stamp}-2`, 'skipped'], [`SP-${stamp}-3`, 'skipped'],
    ])
    expect(String(orders[1].reason)).toContain('ยกเลิกแล้ว')
    expect(String(orders[2].reason)).toContain(`NOT-A-SKU-${stamp}`)
    expect(orders[0].lots).toEqual([{ sku, lotNumber: `LOT-${stamp}`, quantity: 2 }])
    expect(previewed.summary).toMatchObject({ ready: 1, imported: 0, skipped: 2, gross: 780 })

    // Import the ready order.
    const ready = orders.filter((o) => o.resolution === 'ready').map((o) => ({ externalOrderId: o.externalOrderId, orderDate: o.orderDate, buyerName: o.buyerName, lines: o.lines }))
    const imported = await request.post('/api/orva_stock/marketplace-import', { data: { marketplace: 'shopee', brand: 'MRV', orders: ready } })
    expect(imported.status(), await imported.text()).toBe(200)
    const outcome = await readJson(imported)
    const results = outcome.results as Array<Json>
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ externalOrderId: `SP-${stamp}-1`, status: 'imported', gross: 780 })
    expect(String(results[0].invoiceNumber)).not.toBe('')

    // The stock moved: 6 − 2 = 4, which is below the reorder point of 5.
    const lots = ((await readJson(await request.get(`/api/orva_stock/lots?catalogVariantId=${variantId}&all=1`))).items ?? []) as Array<Json>
    expect(Number(lots[0]?.onHand)).toBe(4)
    const valuation = await readJson(await request.get('/api/orva_stock/valuation'))
    const low = ((valuation.lowStock ?? []) as Array<Json>).find((row) => row.variantId === variantId)
    expect(low, 'the valuation names the variant that fell to its reorder point').toMatchObject({ onHand: 4, reorderPoint: 5, sku })

    // The same file again: the sold order is recognised, nothing is written twice.
    const again = await readJson(await request.post('/api/orva_stock/marketplace-import/preview', {
      multipart: { marketplace: 'shopee', mapping: '{}', priceIsLineTotal: '0', file: { name: 'Order.all.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') } },
    }))
    expect((again.orders as Array<Json>)[0]).toMatchObject({ externalOrderId: `SP-${stamp}-1`, resolution: 'imported' })
    const reimport = await readJson(await request.post('/api/orva_stock/marketplace-import', { data: { marketplace: 'shopee', brand: 'MRV', orders: ready } }))
    expect((reimport.results as Array<Json>)[0]).toMatchObject({ status: 'skipped' })
    expect(Number(((await readJson(await request.get(`/api/orva_stock/lots?catalogVariantId=${variantId}&all=1`))).items as Array<Json>)[0]?.onHand)).toBe(4)

    // History shows the one import.
    const history = ((await readJson(await request.get('/api/orva_stock/marketplace-import?marketplace=shopee'))).items ?? []) as Array<Json>
    expect(history.some((row) => row.externalOrderId === `SP-${stamp}-1` && row.status === 'imported')).toBe(true)
  })
})
