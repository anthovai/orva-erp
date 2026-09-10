import { excelSerialToIso, readFirstSheet } from './xlsxLite'

/**
 * A marketplace's order export, read into the orders the ขายปลีก counter
 * would have typed by hand.
 *
 * Three sellers' centres, three files that drift with every UI release; so
 * the parser is a header-alias table per marketplace plus an editable
 * mapping, never a fixed column position. What comes out is plain: one order
 * per marketplace order id, one line per SKU with quantity and the unit price
 * the buyer paid (VAT-inclusive, as the platform shows it). Fees, coupons
 * funded by the platform and the payout are deliberately not here — the tax
 * invoice records what the buyer paid; the platform statement is the
 * accountant's business (spec `2026-09-10-orva-phase-h-department-completion`, A3).
 */
export const MARKETPLACES = ['shopee', 'lazada', 'tiktok', 'custom'] as const
export type Marketplace = (typeof MARKETPLACES)[number]

export type MappingField = 'orderId' | 'sku' | 'quantity' | 'unitPrice' | 'orderDate' | 'status' | 'buyerName' | 'productName'
export type Mapping = Partial<Record<MappingField, string>>
export const REQUIRED_FIELDS: MappingField[] = ['orderId', 'sku', 'unitPrice']

export type ParsedTable = { headers: string[]; rows: string[][] }

export type NormalizedLine = { sku: string; productName: string | null; quantity: number; unitPrice: number }
export type NormalizedOrder = {
  externalOrderId: string
  orderDate: string | null
  status: string | null
  buyerName: string | null
  lines: NormalizedLine[]
  /** why this order will not be imported as it stands (status, bad numbers…); null = importable */
  skipReason: string | null
}

type Preset = {
  label: string
  aliases: Record<MappingField, string[]>
}

const norm = (s: string) => s.replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, ' ')

/** Header names each seller centre has used, Thai and English, current and recent. */
export const PRESETS: Record<Marketplace, Preset> = {
  shopee: {
    label: 'Shopee',
    aliases: {
      orderId: ['หมายเลขคำสั่งซื้อ', 'order id', 'order sn', 'เลขที่คำสั่งซื้อ'],
      sku: ['เลขอ้างอิง sku (sku reference no.)', 'เลขอ้างอิง sku', 'sku reference no.', 'seller sku', 'sku'],
      quantity: ['จำนวน', 'quantity'],
      unitPrice: ['ราคาขาย', 'deal price', 'ราคาขายสุทธิ', 'ราคาตั้งต้น', 'original price'],
      orderDate: ['วันที่ทำการสั่งซื้อ', 'order creation date', 'เวลาที่สั่งซื้อ'],
      status: ['สถานะการสั่งซื้อ', 'order status'],
      buyerName: ['ชื่อผู้รับ', 'receiver name', 'ชื่อผู้ใช้ (ผู้ซื้อ)', 'username (buyer)', 'ชื่อผู้ใช้'],
      productName: ['ชื่อสินค้า', 'product name'],
    },
  },
  lazada: {
    label: 'Lazada',
    aliases: {
      orderId: ['ordernumber', 'order number', 'order id', 'orderid', 'หมายเลขคำสั่งซื้อ'],
      sku: ['sellersku', 'seller sku', 'sku', 'shopsku', 'shop sku'],
      quantity: ['quantity', 'qty', 'จำนวน'],
      unitPrice: ['unitprice', 'unit price', 'paidprice', 'paid price', 'ราคาต่อหน่วย'],
      orderDate: ['createtime', 'create time', 'created at', 'order date', 'วันที่สั่งซื้อ'],
      status: ['status', 'order status', 'สถานะ'],
      buyerName: ['customername', 'customer name', 'shippingname', 'shipping name', 'ชื่อลูกค้า'],
      productName: ['itemname', 'item name', 'product name', 'ชื่อสินค้า'],
    },
  },
  tiktok: {
    label: 'TikTok Shop',
    aliases: {
      orderId: ['order id', 'หมายเลขคำสั่งซื้อ'],
      sku: ['seller sku', 'sku', 'sku id'],
      quantity: ['quantity', 'จำนวน'],
      unitPrice: ['sku unit original price', 'sku subtotal after discount', 'sku unit price', 'unit price', 'ราคาต่อหน่วย'],
      orderDate: ['created time', 'order created time', 'paid time', 'เวลาที่สร้าง'],
      status: ['order status', 'status', 'สถานะคำสั่งซื้อ'],
      buyerName: ['recipient', 'buyer username', 'ชื่อผู้รับ'],
      productName: ['product name', 'ชื่อสินค้า'],
    },
  },
  custom: {
    label: 'กำหนดเอง',
    aliases: {
      orderId: ['order id', 'order', 'เลขที่คำสั่งซื้อ', 'หมายเลขคำสั่งซื้อ'],
      sku: ['sku', 'รหัสสินค้า'],
      quantity: ['quantity', 'qty', 'จำนวน'],
      unitPrice: ['unit price', 'price', 'ราคา', 'ราคาต่อหน่วย'],
      orderDate: ['date', 'order date', 'วันที่'],
      status: ['status', 'สถานะ'],
      buyerName: ['buyer', 'customer', 'ลูกค้า', 'ชื่อผู้รับ'],
      productName: ['product', 'product name', 'ชื่อสินค้า'],
    },
  },
}

/**
 * Orders in these states are not sales yet, or never will be: nothing to
 * invoice, nothing to ship. Anything else (completed, shipping, to ship,
 * delivered…) is imported — a paid order is a sale even before it arrives.
 */
const EXCLUDED_STATUS = /ยกเลิก|cancel|คืน|return|refund|ค้างชำระ|ที่ต้องชำระ|unpaid|awaiting payment|pending payment|failed|ล้มเหลว/i

// ── files ────────────────────────────────────────────────────────────────────

/** RFC 4180 with the sniffed delimiter (comma, semicolon or tab), BOM dropped, CRLF tolerated. */
export function parseCsv(text: string): ParsedTable {
  const source = text.replace(/^﻿/, '')
  const firstLine = source.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = [',', ';', '\t'].map((d) => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0].d
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"') { quoted = true; continue }
    if (ch === delimiter) { row.push(cell); cell = ''; continue }
    if (ch === '\r') continue
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue }
    cell += ch
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row) }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim().length > 0))
  const [headers = [], ...body] = nonEmpty
  return { headers: headers.map((h) => h.trim()), rows: body }
}

/** .xlsx by extension or zip signature, otherwise text — UTF-8, or UTF-16 when the file says so. */
export function parseTable(file: Buffer, filename: string): ParsedTable {
  const isZip = file.length > 4 && file[0] === 0x50 && file[1] === 0x4b
  if (/\.xlsx$/i.test(filename) || isZip) {
    const rows = readFirstSheet(file).filter((r) => r.some((c) => c.trim().length > 0))
    const [headers = [], ...body] = rows
    return { headers: headers.map((h) => h.trim()), rows: body }
  }
  const utf16 = file.length > 1 && ((file[0] === 0xff && file[1] === 0xfe) || (file[0] === 0xfe && file[1] === 0xff))
  const text = utf16 ? file.toString('utf16le') : file.toString('utf8')
  return parseCsv(text)
}

// ── mapping ──────────────────────────────────────────────────────────────────

/** The best header for every field, by exact alias first, then by contains. */
export function suggestMapping(headers: string[], marketplace: Marketplace): Mapping {
  const preset = PRESETS[marketplace]
  const normalized = headers.map(norm)
  const mapping: Mapping = {}
  for (const field of Object.keys(preset.aliases) as MappingField[]) {
    const aliases = preset.aliases[field].map(norm)
    let found = normalized.findIndex((h) => aliases.includes(h))
    if (found < 0) found = normalized.findIndex((h) => aliases.some((a) => a.length >= 3 && h.includes(a)))
    if (found >= 0) mapping[field] = headers[found]
  }
  return mapping
}

export function missingRequired(mapping: Mapping): MappingField[] {
  return REQUIRED_FIELDS.filter((field) => !mapping[field])
}

// ── values ───────────────────────────────────────────────────────────────────

export function parseAmount(raw: string | undefined): number | null {
  if (raw == null) return null
  const cleaned = raw.replace(/[฿$€£,\s]|thb|บาท/gi, '')
  if (cleaned === '') return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

/** ISO day from the shapes these exports use: ISO, dd/mm/yyyy, "yyyy-mm-dd hh:mm", an Excel serial. */
export function parseOrderDate(raw: string | undefined): string | null {
  if (!raw) return null
  const text = raw.trim()
  if (/^\d{4,6}(\.\d+)?$/.test(text)) return excelSerialToIso(Number(text))
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(text)
  if (dmy) {
    const year = Number(dmy[3]) > 2400 ? Number(dmy[3]) - 543 : Number(dmy[3]) // พ.ศ. → ค.ศ.
    return `${year}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  }
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

export const isExcludedStatus = (status: string | null): boolean => status != null && EXCLUDED_STATUS.test(status)

// ── orders ───────────────────────────────────────────────────────────────────

export type NormalizeOptions = {
  /** The price column holds the line total (qty × unit), not the unit price. */
  priceIsLineTotal?: boolean
}

/**
 * Rows → orders. Rows are grouped by order id; lines of the same SKU inside
 * one order are merged (Lazada writes one row per unit). An order is kept
 * whole or skipped whole: one bad line and the whole order asks for a look,
 * because a partial invoice is worse than none.
 */
export function normalizeOrders(table: ParsedTable, mapping: Mapping, options: NormalizeOptions = {}): { orders: NormalizedOrder[]; problems: string[] } {
  const problems: string[] = []
  const missing = missingRequired(mapping)
  if (missing.length) return { orders: [], problems: [`ยังไม่ได้เลือกคอลัมน์: ${missing.join(', ')}`] }
  const col = (field: MappingField): number => {
    const header = mapping[field]
    return header ? table.headers.indexOf(header) : -1
  }
  const at = (row: string[], field: MappingField): string | undefined => {
    const index = col(field)
    return index >= 0 ? (row[index] ?? '').trim() : undefined
  }

  const byOrder = new Map<string, NormalizedOrder>()
  table.rows.forEach((row, rowIndex) => {
    const externalOrderId = at(row, 'orderId') ?? ''
    if (!externalOrderId) { problems.push(`แถว ${rowIndex + 2}: ไม่มีหมายเลขคำสั่งซื้อ`); return }
    const order = byOrder.get(externalOrderId) ?? {
      externalOrderId,
      orderDate: parseOrderDate(at(row, 'orderDate')),
      status: at(row, 'status') || null,
      buyerName: at(row, 'buyerName') || null,
      lines: [],
      skipReason: null,
    }
    byOrder.set(externalOrderId, order)

    const sku = at(row, 'sku') ?? ''
    const quantityRaw = at(row, 'quantity')
    const quantity = quantityRaw === undefined || quantityRaw === '' ? 1 : parseAmount(quantityRaw)
    const price = parseAmount(at(row, 'unitPrice'))
    if (!sku) { order.skipReason ??= 'มีบรรทัดที่ไม่มี SKU'; return }
    if (quantity == null || quantity <= 0) { order.skipReason ??= `จำนวนของ ${sku} อ่านไม่ได้ (${quantityRaw ?? ''})`; return }
    if (price == null || price < 0) { order.skipReason ??= `ราคาของ ${sku} อ่านไม่ได้`; return }
    const unitPrice = options.priceIsLineTotal ? Math.round((price / quantity) * 100) / 100 : price
    const existing = order.lines.find((l) => l.sku.toLowerCase() === sku.toLowerCase())
    if (existing) {
      // same SKU again in one order: units add up, the price stays per unit
      existing.quantity += quantity
    } else {
      order.lines.push({ sku, productName: at(row, 'productName') || null, quantity, unitPrice })
    }
  })

  const orders = [...byOrder.values()].map((order) => {
    if (order.skipReason) return order
    if (isExcludedStatus(order.status)) return { ...order, skipReason: `สถานะ "${order.status}" ไม่ใช่การขาย` }
    if (order.lines.length === 0) return { ...order, skipReason: 'ไม่มีบรรทัดสินค้า' }
    if (order.lines.some((l) => l.unitPrice === 0)) return { ...order, skipReason: 'มีสินค้าราคา 0 — ตรวจคอลัมน์ราคา' }
    return order
  })
  return { orders, problems }
}
