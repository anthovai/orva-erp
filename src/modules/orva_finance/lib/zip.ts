import { deflateRawSync } from 'node:zlib'

/**
 * Minimal ZIP writer (PKZIP 2.0, deflate or store, UTF-8 names) — enough for
 * the ชุดปิดเดือน archive of CSVs, PDFs and a README. Written in-house rather
 * than pulling a zip dependency: the format is ~100 lines, Node already ships
 * the deflate, and the only consumer is one download/email path.
 *
 * Not supported on purpose: encryption, zip64 (>4 GB), streaming. A month of
 * a small company's documents is a few MB.
 */
export type ZipEntry = {
  /** Path inside the archive, '/' separated, UTF-8 (Thai names welcome). */
  name: string
  data: Uint8Array | string
  /** Defaults to now. */
  modified?: Date
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** MS-DOS date/time pair as stored in zip headers (2-second resolution, local time). */
export function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107)
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const dos = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: dos }
}

function u16(view: DataView, offset: number, value: number) { view.setUint16(offset, value, true) }
function u32(view: DataView, offset: number, value: number) { view.setUint32(offset, value >>> 0, true) }

const FLAG_UTF8 = 0x0800
const METHOD_STORE = 0
const METHOD_DEFLATE = 8

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const raw = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data
    const name = encoder.encode(entry.name.replace(/\\/g, '/'))
    const crc = crc32(raw)
    // Deflate only when it helps — PDFs are already compressed and would grow.
    const deflated = raw.length > 0 ? new Uint8Array(deflateRawSync(raw)) : raw
    const useDeflate = deflated.length < raw.length
    const payload = useDeflate ? deflated : raw
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE
    const { time, date } = dosDateTime(entry.modified ?? new Date())

    const local = new Uint8Array(30 + name.length + payload.length)
    const lv = new DataView(local.buffer)
    u32(lv, 0, 0x04034b50)
    u16(lv, 4, 20)
    u16(lv, 6, FLAG_UTF8)
    u16(lv, 8, method)
    u16(lv, 10, time)
    u16(lv, 12, date)
    u32(lv, 14, crc)
    u32(lv, 18, payload.length)
    u32(lv, 22, raw.length)
    u16(lv, 26, name.length)
    u16(lv, 28, 0)
    local.set(name, 30)
    local.set(payload, 30 + name.length)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    u32(cv, 0, 0x02014b50)
    u16(cv, 4, 20)
    u16(cv, 6, 20)
    u16(cv, 8, FLAG_UTF8)
    u16(cv, 10, method)
    u16(cv, 12, time)
    u16(cv, 14, date)
    u32(cv, 16, crc)
    u32(cv, 20, payload.length)
    u32(cv, 24, raw.length)
    u16(cv, 28, name.length)
    u16(cv, 30, 0)
    u16(cv, 32, 0)
    u16(cv, 34, 0)
    u16(cv, 36, 0)
    u32(cv, 38, 0)
    u32(cv, 42, offset)
    central.set(name, 46)

    locals.push(local)
    centrals.push(central)
    offset += local.length
  }

  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  u32(ev, 0, 0x06054b50)
  u16(ev, 4, 0)
  u16(ev, 6, 0)
  u16(ev, 8, entries.length)
  u16(ev, 10, entries.length)
  u32(ev, 12, centralSize)
  u32(ev, 16, offset)
  u16(ev, 20, 0)

  const out = new Uint8Array(offset + centralSize + 22)
  let cursor = 0
  for (const chunk of [...locals, ...centrals, end]) {
    out.set(chunk, cursor)
    cursor += chunk.length
  }
  return out
}

/**
 * Reads back the central directory of an archive produced above — used by
 * tests and by nothing else. Returns names, sizes and CRCs in order.
 */
export function listZip(bytes: Uint8Array): Array<{ name: string; size: number; crc: number; method: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = bytes.length - 22
  if (view.getUint32(eocd, true) !== 0x06054b50) throw new Error('not a zip produced by buildZip')
  const count = view.getUint16(eocd + 10, true)
  let cursor = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder()
  const out: Array<{ name: string; size: number; crc: number; method: number }> = []
  for (let i = 0; i < count; i++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('bad central header')
    const method = view.getUint16(cursor + 10, true)
    const crc = view.getUint32(cursor + 16, true)
    const size = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
    out.push({ name, size, crc, method })
    cursor += 46 + nameLength
  }
  return out
}
