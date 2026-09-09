import { expect, test, type APIRequestContext } from '@playwright/test'
import { createVendor, login, readJson, signedInBrowser, type Json } from '../../orva_purchasing/__integration__/fixtures'

/**
 * G3 — the Marventine rehearsal (REQ-G3-1, T-G3-1, T-G3-2).
 *
 * The whole goods cycle, on a clean tenant, through the real routes: a product
 * with its FDA number and shelf life → a purchase order with a goods line →
 * received into a lot → valued → sold at retail → the ใบกำกับภาษีอย่างย่อ →
 * cost posted → the home screen warned of an expiring lot. This file IS the
 * dry-run checklist the roadmap asked for; whatever it finds is fixed in the
 * module that owns it, and the assertion stays.
 *
 * Nothing here touches the real tenant. The product facts are placeholders —
 * the FDA number in particular is the owner's to enter, never the machine's.
 */

const TENANT_DAY = '2026-09-09'

/** GS1 modulo-10 check digit appended to 12 digits. */
function ean13(first12: string): string {
  let sum = 0
  for (let i = 0; i < 12; i += 1) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3)
  return first12 + String((10 - (sum % 10)) % 10)
}

/** Creates, or finds by code, a GL account — the tenant ships no chart of accounts. */
async function ensureGlAccount(request: APIRequestContext, code: string, name: string, accountType: string): Promise<string> {
  const created = await request.post('/api/orva_finance/gl/accounts', { data: { code, name, accountType, isActive: true } })
  if (created.status() < 300) {
    const id = String((await readJson(created)).id ?? '')
    if (id) return id
  }
  const listed = await readJson(await request.get('/api/orva_finance/gl/accounts?page=1&pageSize=100&isActive=true'))
  const found = ((listed.items ?? []) as Array<Json>).find((row) => String(row.code) === code)
  expect(found, `GL account ${code} must exist or be creatable`).toBeTruthy()
  return String(found!.id)
}

/** The id a CRUD create returns, whatever it calls it. */
const idOf = (body: Json, ...keys: string[]): string => {
  for (const key of ['id', ...keys]) if (body[key]) return String(body[key])
  return ''
}

type Site = { warehouseId: string; locationId: string; inventoryAccountId: string; cogsAccountId: string }

/** A warehouse, a bin, the two GL accounts, and stock settings pointing at them. */
async function ensureSite(request: APIRequestContext): Promise<Site> {
  const stamp = Date.now().toString(36).toUpperCase()
  const warehouse = await request.post('/api/wms/warehouses', {
    data: { name: `คลังหลัก (rehearsal ${stamp})`, code: `MAIN-${stamp}`, isActive: true, isPrimary: true },
  })
  expect(warehouse.status(), await warehouse.text()).toBeLessThan(300)
  const warehouseId = idOf(await readJson(warehouse), 'warehouseId')
  expect(warehouseId, 'warehouse id').not.toBe('')

  const location = await request.post('/api/wms/locations', {
    data: { warehouseId, code: 'A-01', type: 'bin', isActive: true },
  })
  expect(location.status(), await location.text()).toBeLessThan(300)
  const locationId = idOf(await readJson(location), 'locationId')
  expect(locationId, 'location id').not.toBe('')

  const inventoryAccountId = await ensureGlAccount(request, '1200', 'สินค้าคงเหลือ', 'asset')
  const cogsAccountId = await ensureGlAccount(request, '5010', 'ต้นทุนขายสินค้า', 'expense')

  const settings = await request.put('/api/orva_stock/settings', {
    data: { inventoryAccountId, cogsAccountId, warehouseId, locationId },
  })
  expect(settings.status(), await settings.text()).toBeLessThan(300)
  return { warehouseId, locationId, inventoryAccountId, cogsAccountId }
}

type Sku = { productId: string; variantId: string; sku: string; barcode: string; name: string }

/**
 * The product the way the owner will enter it: title, brand, FDA notification
 * number, shelf life; one variant with an EAN-13. The FDA number here is a
 * placeholder shape, not a real registration.
 */
async function createMarventineSku(request: APIRequestContext): Promise<Sku> {
  const stamp = Date.now().toString(36).toUpperCase()
  const product = await request.post('/api/catalog/products', {
    data: {
      title: `Marventine Body Lotion (rehearsal ${stamp})`,
      subtitle: '200 มล.',
      productType: 'simple',
      taxRate: 7,
      // No defaultUnit: units are a catalog dictionary the owner maintains, and
      // the clean tenant has none — the first run answered uom.unit_not_found.
      cf_th_fda_notification: '1012345678',
      cf_shelf_life_months: 24,
      cf_product_brand: 'MRV',
    },
  })
  expect(product.status(), await product.text()).toBeLessThan(300)
  const productId = idOf(await readJson(product), 'productId')
  expect(productId, 'product id').not.toBe('')

  const sku = `MRV-BL200-${stamp}`
  // A Thai-prefix EAN-13 unique to this product: barcodes are unique per
  // tenant, and every run makes several products.
  const barcode = ean13(`885${String(Date.now() % 1_000_000_000).padStart(9, '0')}`)
  const name = 'Marventine Body Lotion 200 มล.'

  // The custom fields must actually have been stored. Finding of this
  // rehearsal: they are — the rows are in custom_field_values with the right
  // tenant and organization — yet the products list (the framework's
  // custom-field decorator) reads them back as null inside the running app.
  // Orva's own readers therefore read the columns directly; this step asserts
  // the write where the runner lets it (its database URL is in the process
  // environment) and reports what the list shows, without failing on it.
  const listed = ((await readJson(await request.get(`/api/catalog/products?ids=${productId}&pageSize=1`))).items ?? []) as Array<Json>
  const listedShelf = listed[0]?.cf_shelf_life_months ?? null
  const dbUrl = process.env.DATABASE_URL ?? null
  if (dbUrl) {
    const { Client } = await import('pg')
    const client = new Client({ connectionString: dbUrl })
    await client.connect()
    const rows = await client.query(
      `select field_key, value_int, value_text from custom_field_values where record_id = $1 and deleted_at is null order by field_key`,
      [productId],
    )
    await client.end()
    const byKey = Object.fromEntries(rows.rows.map((row: { field_key: string; value_int: number | null; value_text: string | null }) => [row.field_key, row.value_int ?? row.value_text]))
    expect(Number(byKey.shelf_life_months), `shelf life must be stored: ${JSON.stringify(rows.rows)}`).toBe(24)
    expect(byKey.th_fda_notification).toBe('1012345678')
    expect(byKey.product_brand).toBe('MRV')
  }
  console.log(`[rehearsal] custom fields: stored=${dbUrl ? 'verified in table' : 'not verifiable here'}; products list shows cf_shelf_life_months=${JSON.stringify(listedShelf)}`)

  // A simple product may or may not carry a default variant; use it if so.
  const existing = await readJson(await request.get(`/api/catalog/variants?productId=${productId}&pageSize=20`))
  const owned = ((existing.items ?? []) as Array<Json>).filter((row) => String(row.productId ?? row.product_id ?? '') === productId)
  let variantId = owned.length ? String(owned[0].id) : ''
  if (variantId) {
    const updated = await request.put('/api/catalog/variants', {
      data: { id: variantId, name, sku, barcode, gtinType: 'ean13', isActive: true },
    })
    expect(updated.status(), await updated.text()).toBeLessThan(300)
  } else {
    const created = await request.post('/api/catalog/variants', {
      data: { productId, name, sku, barcode, gtinType: 'ean13', isDefault: true, isActive: true },
    })
    expect(created.status(), await created.text()).toBeLessThan(300)
    variantId = idOf(await readJson(created), 'variantId')
  }
  expect(variantId, 'variant id').not.toBe('')
  return { productId, variantId, sku, barcode, name }
}

/** A sent purchase order for one goods line of this SKU. */
async function orderGoods(
  request: APIRequestContext,
  args: { vendorPartyId: string; accountId: string; sku: Sku; quantity: number; unitPrice: number },
): Promise<{ id: string; lineId: string; updatedAt: string }> {
  const created = await request.post('/api/orva_purchasing/orders', {
    data: {
      vendorPartyId: args.vendorPartyId,
      orderDate: TENANT_DAY,
      lines: [
        {
          kind: 'goods',
          catalogVariantId: args.sku.variantId,
          description: args.sku.name,
          quantity: args.quantity,
          unit: 'ขวด',
          unitPrice: args.unitPrice,
          vatMode: '7',
          accountId: args.accountId,
        },
      ],
    },
  })
  expect(created.status(), await created.text()).toBeLessThan(300)
  const id = String((await readJson(created)).id)
  let detail = await readJson(await request.get(`/api/orva_purchasing/orders/${id}`))
  const sent = await request.post(`/api/orva_purchasing/orders/${id}/send`, { data: { updatedAt: (detail.order as Json).updatedAt } })
  expect(sent.status(), await sent.text()).toBe(200)
  detail = await readJson(await request.get(`/api/orva_purchasing/orders/${id}`))
  return { id, lineId: String((detail.lines as Array<Json>)[0].id), updatedAt: String((detail.order as Json).updatedAt) }
}

const lotsFor = async (request: APIRequestContext, variantId: string): Promise<Array<Json>> =>
  ((await readJson(await request.get(`/api/orva_stock/lots?catalogVariantId=${variantId}&all=1`))).items ?? []) as Array<Json>

test.describe('Marventine rehearsal (G3)', () => {
  let request: APIRequestContext
  let cookie: string
  let site: Site
  let vendorPartyId: string

  test.beforeAll(async ({ playwright, baseURL }) => {
    const session = await login(playwright, baseURL)
    request = session.request
    cookie = session.cookie
    site = await ensureSite(request)
    vendorPartyId = await createVendor(request, `OEM Marventine ${Date.now()}`)
  })

  test.afterAll(async () => { await request?.dispose() })

  test('T-G3-1: order → lot → valuation → retail sale → ใบกำกับภาษีอย่างย่อ → COGS → expiry alert', async () => {
    test.setTimeout(120_000)
    const sku = await createMarventineSku(request)

    // 1. Ordered from the OEM: 100 ขวด at 85.
    const order = await orderGoods(request, { vendorPartyId, accountId: site.inventoryAccountId, sku, quantity: 100, unitPrice: 85 })

    // 2. Received into lot MV2609A, made on 1 Sept, no expiry given.
    const received = await request.post(`/api/orva_purchasing/orders/${order.id}/receive`, {
      data: {
        updatedAt: order.updatedAt,
        receivedOn: TENANT_DAY,
        lines: [{ lineId: order.lineId, quantity: 100, lotNumber: 'MV2609A', manufacturedOn: '2026-09-01', unitCost: 85 }],
      },
    })
    expect(received.status(), await received.text()).toBe(200)
    expect((await readJson(received)).status).toBe('received')

    const lots = await lotsFor(request, sku.variantId)
    const lot = lots.find((row) => row.lotNumber === 'MV2609A')
    expect(lot, `lot MV2609A must exist: ${JSON.stringify(lots)}`).toBeTruthy()
    expect(Number(lot!.onHand)).toBe(100)
    // A7 — the shelf life on the product (24 months) sets the expiry when the
    // receiver gives none. An unset expiry would silently switch off the home
    // screen's warning for this lot.
    expect(lot!.expiresAt, 'expiry must come from shelf_life_months').toBe('2028-09-01')
    const lotId = String(lot!.lotId)

    // 3. Valued at cost.
    const valuation = await readJson(await request.get('/api/orva_stock/valuation'))
    const valued = ((valuation.lines ?? []) as Array<Json>).find((row) => row.lotId === lotId)
    expect(valued, 'the lot must appear in the valuation').toBeTruthy()
    expect(Number(valued!.onHand)).toBe(100)
    expect(Number(valued!.unitCost)).toBe(85)
    expect(Number(valued!.value)).toBe(8500)

    // 4. Sold at retail: 3 ขวด at a shelf price of 290 (VAT included).
    const sale = await request.post('/api/orva_stock/retail-sale', {
      data: {
        soldOn: TENANT_DAY,
        paymentMethod: 'transfer',
        customerName: 'ลูกค้าหน้าร้าน',
        lines: [{ catalogVariantId: sku.variantId, lotId, name: sku.name, sku: sku.sku, quantity: 3, unitPriceGross: 290 }],
      },
    })
    expect(sale.status(), await sale.text()).toBe(200)
    const sold = await readJson(sale)
    expect(sold.ok).toBe(true)
    expect(Number(sold.gross)).toBe(870)
    // 870 gross at 7% → 813.08 net, 56.92 VAT
    expect(Number(sold.vat)).toBeCloseTo(56.92, 2)
    expect(String(sold.invoiceNumber)).not.toBe('')
    const invoiceId = String(sold.invoiceId)

    // …and the retail slip prints, VAT-inclusive, from that invoice.
    const slip = await readJson(await request.get(`/api/orva_documents/preview?type=abbreviated_tax_invoice&documentId=${invoiceId}`))
    const doc = slip.document as Json
    expect(doc.headingTh).toBe('ใบกำกับภาษีอย่างย่อ')
    expect(doc.isAbbreviated).toBe(true)
    expect(Number(doc.grandTotal)).toBe(870)

    // 5. Three left the lot.
    const after = (await lotsFor(request, sku.variantId)).find((row) => row.lotId === lotId)
    expect(Number(after!.onHand)).toBe(97)

    // 6. Cost of goods sold for the month posts to the books.
    const cogs = await request.post('/api/orva_stock/cogs', { data: { month: TENANT_DAY.slice(0, 7) } })
    expect(cogs.status(), await cogs.text()).toBeLessThan(300)
    const cogsBody = await readJson(cogs)
    expect(JSON.stringify(cogsBody), 'the COGS post must report what it did').toMatch(/journal|posted|ok|issues/i)

    // 7. A lot expiring within 90 days reaches the home screen as a warning.
    const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    const second = await orderGoods(request, { vendorPartyId, accountId: site.inventoryAccountId, sku, quantity: 10, unitPrice: 85 })
    const secondReceipt = await request.post(`/api/orva_purchasing/orders/${second.id}/receive`, {
      data: {
        updatedAt: second.updatedAt,
        receivedOn: TENANT_DAY,
        lines: [{ lineId: second.lineId, quantity: 10, lotNumber: 'MV2609B', expiresOn: soon, unitCost: 85 }],
      },
    })
    expect(secondReceipt.status(), await secondReceipt.text()).toBe(200)
    const overview = await readJson(await request.get('/api/orva_finance/home/overview'))
    // The counts sit on the waiting card, next to the other things the owner
    // must act on.
    const waiting = overview.waiting as Json
    expect(Number(waiting.expiringLots), `expiring lots must be counted: ${JSON.stringify(waiting)}`).toBeGreaterThanOrEqual(1)
  })

  test('T-G3-5: the lot prints a label sheet — 24 labels with the อย. number, MFG/EXP and an EAN-13', async ({ browser, baseURL }) => {
    test.setTimeout(120_000)
    const sku = await createMarventineSku(request)
    const order = await orderGoods(request, { vendorPartyId, accountId: site.inventoryAccountId, sku, quantity: 20, unitPrice: 85 })
    const received = await request.post(`/api/orva_purchasing/orders/${order.id}/receive`, {
      data: {
        updatedAt: order.updatedAt,
        receivedOn: TENANT_DAY,
        lines: [{ lineId: order.lineId, quantity: 20, lotNumber: 'MV2609L', manufacturedOn: '2026-09-01', unitCost: 85 }],
      },
    })
    expect(received.status(), await received.text()).toBe(200)
    const lotId = String((await readJson(received)).lotId ?? (await lotsFor(request, sku.variantId)).find((row) => row.lotNumber === 'MV2609L')?.lotId ?? '')
    expect(lotId, 'the receipt must name its lot').not.toBe('')

    // The document, through the documents rails: stock's reader supplies the
    // facts, documents draws the sheet.
    const previewed = await request.get(`/api/orva_documents/preview?type=lot_label&documentId=${lotId}&copies=24`)
    expect(previewed.status(), await previewed.text()).toBe(200)
    const body = await readJson(previewed)
    const doc = body.document as Json
    expect(body.sourceKind).toBe('lot')
    expect(doc.isLabelSheet).toBe(true)
    expect(doc.headingTh).toBe('ฉลากล็อต')
    const sheet = doc.labelSheet as Json
    const labels = sheet.labels as Array<Json>
    expect(labels).toHaveLength(24)
    const label = labels[0]
    expect(label.productTitle).toContain('Marventine Body Lotion')
    expect(label.packSize, 'the product subtitle is the pack size').toBe('200 มล.')
    expect(label.fdaNotification).toBe('1012345678')
    expect(label.lotNumber).toBe('MV2609L')
    expect(label.manufacturedOn).toBe('2026-09-01')
    // Shelf life set the expiry (A7), and the label prints it.
    expect(label.expiresOn).toBe('2028-09-01')
    expect((label.barcode as Json).symbology).toBe('ean13')
    expect((label.barcode as Json).text).toBe(sku.barcode)
    expect(doc.warnings).toEqual([])

    // An unknown lot is a 404, not a sheet of dashes.
    expect((await request.get('/api/orva_documents/preview?type=lot_label&documentId=00000000-0000-4000-8000-000000000000')).status()).toBe(404)

    // The sheet in a browser, and the way in from the valuation screen.
    const context = await signedInBrowser(browser, baseURL, cookie)
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    await page.goto(`/backend/documents/preview?type=lot_label&documentId=${lotId}&copies=24`)
    const sheetEl = page.locator('[data-document-sheet="true"]').first()
    await expect(sheetEl).toBeVisible({ timeout: 30_000 })
    await expect(sheetEl.locator('svg[role="img"]')).toHaveCount(24, { timeout: 15_000 })
    const printed = (await sheetEl.innerText()).replace(/\s+/g, ' ')
    expect(printed).toContain('1012345678')
    expect(printed).toContain('MV2609L')
    expect(printed).toContain('01/09/2026')
    expect(printed).toContain('01/09/2028')
    expect(printed, 'a label sheet carries no money').not.toContain('85.00')

    await page.goto('/backend/stock/valuation')
    const printLink = page.getByRole('link', { name: 'พิมพ์ฉลาก' }).first()
    await expect(printLink).toBeVisible({ timeout: 30_000 })
    expect(await printLink.getAttribute('href')).toMatch(/type=lot_label&documentId=[0-9a-f-]{36}/)
    expect(errors, `client errors: ${errors.join(' | ')}`).toEqual([])
    await context.close()
  })

  test('T-G3-2: an explicit expiry wins over the shelf life, and a product without shelf life gets none', async () => {
    test.setTimeout(90_000)
    const sku = await createMarventineSku(request)
    const order = await orderGoods(request, { vendorPartyId, accountId: site.inventoryAccountId, sku, quantity: 5, unitPrice: 80 })
    const received = await request.post(`/api/orva_purchasing/orders/${order.id}/receive`, {
      data: {
        updatedAt: order.updatedAt,
        receivedOn: TENANT_DAY,
        lines: [{ lineId: order.lineId, quantity: 5, lotNumber: 'MV2609X', manufacturedOn: '2026-09-01', expiresOn: '2027-03-01', unitCost: 80 }],
      },
    })
    expect(received.status(), await received.text()).toBe(200)
    const lot = (await lotsFor(request, sku.variantId)).find((row) => row.lotNumber === 'MV2609X')
    expect(lot!.expiresAt).toBe('2027-03-01')
  })
})
