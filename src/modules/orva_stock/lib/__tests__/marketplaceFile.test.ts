import { describe, expect, it } from '@jest/globals'
import { deflateRawSync } from 'node:zlib'
import { columnIndex, excelSerialToIso, readFirstSheet } from '../xlsxLite'
import { isExcludedStatus, normalizeOrders, parseAmount, parseCsv, parseOrderDate, parseTable, suggestMapping } from '../marketplaceFile'

// ── a tiny .xlsx writer for the tests: a zip (stored/deflated) of the parts the reader needs ──

function crc32(buf: Buffer): number {
  let crc = ~0
  for (const byte of buf) {
    crc ^= byte
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

function zip(files: Array<{ name: string; data: string }>): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const raw = Buffer.from(file.data, 'utf8')
    const packed = deflateRawSync(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8)
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12); local.writeUInt32LE(crc32(raw), 14)
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0, 8); entry.writeUInt16LE(8, 10)
    entry.writeUInt16LE(0, 12); entry.writeUInt16LE(0, 14); entry.writeUInt32LE(crc32(raw), 16); entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(raw.length, 24)
    entry.writeUInt16LE(name.length, 28); entry.writeUInt16LE(0, 30); entry.writeUInt16LE(0, 32); entry.writeUInt16LE(0, 34); entry.writeUInt16LE(0, 36)
    entry.writeUInt32LE(0, 38); entry.writeUInt32LE(offset, 42)
    locals.push(local, name, packed)
    central.push(entry, name)
    offset += local.length + name.length + packed.length
  }
  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10); eocd.writeUInt32LE(centralBuf.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, centralBuf, eocd])
}

function xlsx(rows: Array<Array<string | number>>): Buffer {
  const strings: string[] = []
  const sst = (s: string) => { let i = strings.indexOf(s); if (i < 0) { strings.push(s); i = strings.length - 1 } return i }
  const col = (i: number) => String.fromCharCode(65 + i)
  const sheetRows = rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => typeof v === 'number'
    ? `<c r="${col(c)}${r + 1}"><v>${v}</v></c>`
    : `<c r="${col(c)}${r + 1}" t="s"><v>${sst(v)}</v></c>`).join('')}</row>`).join('')
  return zip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'xl/workbook.xml', data: '<workbook xmlns:r="r"><sheets><sheet name="Orders" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/sharedStrings.xml', data: `<sst>${strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('')}</sst>` },
    { name: 'xl/worksheets/sheet1.xml', data: `<worksheet><sheetData>${sheetRows}</sheetData></worksheet>` },
  ])
}

describe('xlsxLite reads what a seller centre exports', () => {
  it('reads the first sheet with shared strings, numbers and Thai text', () => {
    const rows = readFirstSheet(xlsx([['หมายเลขคำสั่งซื้อ', 'จำนวน', 'Note & more'], ['2509ABC', 2, 'ok <x>']]))
    expect(rows).toEqual([['หมายเลขคำสั่งซื้อ', 'จำนวน', 'Note & more'], ['2509ABC', '2', 'ok <x>']])
  })

  it('maps column letters and Excel serial dates', () => {
    expect(columnIndex('A1')).toBe(0)
    expect(columnIndex('Z9')).toBe(25)
    expect(columnIndex('AB3')).toBe(27)
    expect(excelSerialToIso(46275)).toBe('2026-09-10')
  })

  it('refuses a file that is not a zip with a plain message', () => {
    expect(() => readFirstSheet(Buffer.from('not a spreadsheet'))).toThrow(/xlsx/)
  })
})

describe('CSV parsing', () => {
  it('handles BOM, quoted commas, doubled quotes, CRLF and semicolons', () => {
    const table = parseCsv('﻿Order ID;SKU;Price\r\n"A;1";"MRV-""BL200""";1,290.00\r\n')
    expect(table.headers).toEqual(['Order ID', 'SKU', 'Price'])
    expect(table.rows).toEqual([['A;1', 'MRV-"BL200"', '1,290.00']])
  })

  it('parseTable picks xlsx by signature and csv otherwise', () => {
    expect(parseTable(xlsx([['a', 'b'], ['1', '2']]), 'orders.bin').headers).toEqual(['a', 'b'])
    expect(parseTable(Buffer.from('a,b\n1,2\n'), 'orders.csv').rows).toEqual([['1', '2']])
  })
})

describe('mapping presets recognise each marketplace', () => {
  it('Shopee (Thai export)', () => {
    const mapping = suggestMapping(['หมายเลขคำสั่งซื้อ', 'สถานะการสั่งซื้อ', 'เลขอ้างอิง SKU (SKU Reference No.)', 'ชื่อสินค้า', 'จำนวน', 'ราคาขาย', 'วันที่ทำการสั่งซื้อ', 'ชื่อผู้รับ'], 'shopee')
    expect(mapping).toMatchObject({ orderId: 'หมายเลขคำสั่งซื้อ', status: 'สถานะการสั่งซื้อ', sku: 'เลขอ้างอิง SKU (SKU Reference No.)', quantity: 'จำนวน', unitPrice: 'ราคาขาย', orderDate: 'วันที่ทำการสั่งซื้อ', buyerName: 'ชื่อผู้รับ', productName: 'ชื่อสินค้า' })
  })

  it('Lazada and TikTok (English exports)', () => {
    expect(suggestMapping(['orderNumber', 'status', 'sellerSku', 'itemName', 'unitPrice', 'createTime', 'customerName'], 'lazada'))
      .toMatchObject({ orderId: 'orderNumber', status: 'status', sku: 'sellerSku', unitPrice: 'unitPrice', orderDate: 'createTime', buyerName: 'customerName' })
    expect(suggestMapping(['Order ID', 'Order Status', 'Seller SKU', 'Product Name', 'Quantity', 'SKU Unit Original Price', 'Created Time', 'Recipient'], 'tiktok'))
      .toMatchObject({ orderId: 'Order ID', status: 'Order Status', sku: 'Seller SKU', quantity: 'Quantity', unitPrice: 'SKU Unit Original Price', orderDate: 'Created Time', buyerName: 'Recipient' })
  })
})

describe('values', () => {
  it('reads amounts with currency signs and thousands separators', () => {
    expect(parseAmount('฿1,290.00')).toBe(1290)
    expect(parseAmount('390 บาท')).toBe(390)
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
  })

  it('reads the date shapes the exports use, including พ.ศ. and Excel serials', () => {
    expect(parseOrderDate('2026-09-08 14:22')).toBe('2026-09-08')
    expect(parseOrderDate('08/09/2026 14:22')).toBe('2026-09-08')
    expect(parseOrderDate('08/09/2569')).toBe('2026-09-08')
    expect(parseOrderDate('46275')).toBe('2026-09-10')
    expect(parseOrderDate('')).toBeNull()
  })

  it('knows which statuses are not sales', () => {
    expect(isExcludedStatus('ยกเลิกแล้ว')).toBe(true)
    expect(isExcludedStatus('Cancelled')).toBe(true)
    expect(isExcludedStatus('คืนเงิน/คืนสินค้า')).toBe(true)
    expect(isExcludedStatus('ที่ต้องชำระ')).toBe(true)
    expect(isExcludedStatus('สำเร็จแล้ว')).toBe(false)
    expect(isExcludedStatus('กำลังจัดส่ง')).toBe(false)
    expect(isExcludedStatus(null)).toBe(false)
  })
})

describe('normalizeOrders', () => {
  const headers = ['Order ID', 'Order Status', 'Seller SKU', 'Quantity', 'Unit Price', 'Created Time', 'Recipient']
  const mapping = suggestMapping(headers, 'tiktok')

  it('groups rows into orders, merges repeated SKUs, and skips whole orders that are not sales', () => {
    const { orders, problems } = normalizeOrders({
      headers,
      rows: [
        ['O-1', 'Completed', 'MRV-BL200', '1', '390', '2026-09-08 10:00', 'คุณเอ'],
        ['O-1', 'Completed', 'MRV-BL200', '1', '390', '2026-09-08 10:00', 'คุณเอ'],
        ['O-1', 'Completed', 'MRV-HC100', '2', '250', '2026-09-08 10:00', 'คุณเอ'],
        ['O-2', 'Cancelled', 'MRV-BL200', '1', '390', '2026-09-08 11:00', 'คุณบี'],
        ['O-3', 'Shipped', 'MRV-BL200', 'x', '390', '2026-09-09', 'คุณซี'],
      ],
    }, mapping)
    expect(problems).toEqual([])
    expect(orders).toHaveLength(3)
    const [one, two, three] = orders
    expect(one).toMatchObject({ externalOrderId: 'O-1', orderDate: '2026-09-08', buyerName: 'คุณเอ', skipReason: null })
    expect(one.lines).toEqual([
      { sku: 'MRV-BL200', productName: null, quantity: 2, unitPrice: 390 },
      { sku: 'MRV-HC100', productName: null, quantity: 2, unitPrice: 250 },
    ])
    expect(two.skipReason).toMatch(/Cancelled/)
    expect(three.skipReason).toMatch(/จำนวน/)
  })

  it('divides a line total by the quantity when told the price column is a total', () => {
    const { orders } = normalizeOrders({ headers, rows: [['O-9', 'Completed', 'MRV-BL200', '3', '1170', '2026-09-08', '']] }, mapping, { priceIsLineTotal: true })
    expect(orders[0].lines[0]).toMatchObject({ quantity: 3, unitPrice: 390 })
  })

  it('names the missing required columns instead of guessing', () => {
    const { orders, problems } = normalizeOrders({ headers, rows: [] }, { orderId: 'Order ID' })
    expect(orders).toEqual([])
    expect(problems[0]).toMatch(/sku.*unitPrice|unitPrice.*sku/)
  })

  it('defaults the quantity to one when the file has no quantity column (Lazada writes one row per unit)', () => {
    const lazadaHeaders = ['orderNumber', 'status', 'sellerSku', 'unitPrice']
    const { orders } = normalizeOrders({ headers: lazadaHeaders, rows: [['L-1', 'delivered', 'MRV-BL200', '390'], ['L-1', 'delivered', 'MRV-BL200', '390']] }, suggestMapping(lazadaHeaders, 'lazada'))
    expect(orders[0].lines).toEqual([{ sku: 'MRV-BL200', productName: null, quantity: 2, unitPrice: 390 }])
  })
})
