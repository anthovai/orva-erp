import { describe, expect, test } from '@jest/globals'
import { inflateRawSync } from 'node:zlib'
import { buildZip, crc32, dosDateTime, listZip } from '../zip'

describe('zip writer', () => {
  test('crc32 matches the reference vector', () => {
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926')
    expect(crc32(new Uint8Array())).toBe(0)
  })

  test('dos date/time packs year, month, day, 2-second time', () => {
    const { date, time } = dosDateTime(new Date(2026, 8, 3, 14, 30, 10))
    expect(date >> 9).toBe(46) // 2026 - 1980
    expect((date >> 5) & 0xf).toBe(9)
    expect(date & 0x1f).toBe(3)
    expect(time >> 11).toBe(14)
    expect((time >> 5) & 0x3f).toBe(30)
    expect(time & 0x1f).toBe(5)
  })

  test('archive lists its entries with Thai names, sizes and CRCs; compressible entries deflate', () => {
    const csv = 'a,b\r\n'.repeat(200)
    const pdfish = new Uint8Array(64).map((_, i) => (i * 97) % 256)
    const zip = buildZip([
      { name: 'ภ.พ.30/รายงานภาษีขาย.csv', data: csv, modified: new Date(2026, 8, 1) },
      { name: 'เอกสารภาษี/KKG-INV-2026013.pdf', data: pdfish, modified: new Date(2026, 8, 1) },
      { name: 'README.txt', data: '', modified: new Date(2026, 8, 1) },
    ])
    const listed = listZip(zip)
    expect(listed.map((e) => e.name)).toEqual(['ภ.พ.30/รายงานภาษีขาย.csv', 'เอกสารภาษี/KKG-INV-2026013.pdf', 'README.txt'])
    expect(listed[0].size).toBe(new TextEncoder().encode(csv).length)
    expect(listed[0].method).toBe(8)
    expect(listed[0].crc).toBe(crc32(new TextEncoder().encode(csv)))
    expect(listed[1].method).toBe(0) // incompressible → stored
    expect(listed[2].size).toBe(0)
    // signature and end-of-central-directory
    expect(zip.subarray(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))
    expect(zip.subarray(zip.length - 22, zip.length - 18)).toEqual(new Uint8Array([0x50, 0x4b, 0x05, 0x06]))
  })

  test('the deflated payload inflates back to the original bytes', () => {
    const text = 'สวัสดี,ประเทศไทย\r\n'.repeat(50)
    const raw = new TextEncoder().encode(text)
    const zip = buildZip([{ name: 'x.csv', data: text }])
    const view = new DataView(zip.buffer)
    const compressedSize = view.getUint32(18, true)
    const nameLength = view.getUint16(26, true)
    const payload = zip.subarray(30 + nameLength, 30 + nameLength + compressedSize)
    expect(new Uint8Array(inflateRawSync(payload))).toEqual(raw)
  })
})
