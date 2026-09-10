import { inflateRawSync } from 'node:zlib'

/**
 * The smallest reader that turns a marketplace's .xlsx export into rows of
 * text — the first worksheet, shared strings resolved, numbers as written,
 * dates as ISO days. Nothing else: no styles, no formulas, no writing.
 *
 * Written rather than installed because every seller-centre exports .xlsx
 * and the app carries no spreadsheet dependency; an .xlsx is a zip of XML,
 * and Node already inflates deflate streams. Anything this reader does not
 * understand (encrypted, zip64, other sheets) fails with a plain message,
 * and the owner can still save the file as CSV.
 */

type ZipEntry = { name: string; compression: number; compressedSize: number; localHeaderOffset: number }

function readZipEntries(buffer: Buffer): ZipEntry[] {
  // End of central directory: scan backwards for its signature.
  let eocd = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66_000); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('ไฟล์นี้ไม่ใช่ .xlsx ที่อ่านได้ (ไม่พบสารบัญของไฟล์)')
  const entryCount = buffer.readUInt16LE(eocd + 10)
  const directoryOffset = buffer.readUInt32LE(eocd + 16)
  if (entryCount === 0xffff || directoryOffset === 0xffffffff) throw new Error('ไฟล์ .xlsx นี้ใหญ่เกินที่ตัวอ่านรองรับ (zip64) — บันทึกเป็น CSV แล้วอัปโหลดแทน')
  const entries: ZipEntry[] = []
  let cursor = directoryOffset
  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('ไฟล์ .xlsx เสียหาย (สารบัญไม่ตรง)')
    const compression = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    entries.push({ name, compression, compressedSize, localHeaderOffset })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function readZipFile(buffer: Buffer, entry: ZipEntry): Buffer {
  const header = entry.localHeaderOffset
  if (buffer.readUInt32LE(header) !== 0x04034b50) throw new Error('ไฟล์ .xlsx เสียหาย (ส่วนหัวไฟล์ย่อยไม่ตรง)')
  const nameLength = buffer.readUInt16LE(header + 26)
  const extraLength = buffer.readUInt16LE(header + 28)
  const start = header + 30 + nameLength + extraLength
  const data = buffer.subarray(start, start + entry.compressedSize)
  if (entry.compression === 0) return Buffer.from(data)
  if (entry.compression === 8) return inflateRawSync(data)
  throw new Error('ไฟล์ .xlsx ใช้วิธีบีบอัดที่ตัวอ่านไม่รองรับ — บันทึกเป็น CSV แล้วอัปโหลดแทน')
}

const decodeXml = (text: string): string =>
  text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')

/** Every <t> inside one <si>, joined — rich-text runs are several <t>s. */
function sharedStrings(xml: string | null): string[] {
  if (!xml) return []
  const out: string[] = []
  const items = xml.match(/<si>[\s\S]*?<\/si>/g) ?? []
  for (const item of items) {
    const parts = [...item.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]))
    out.push(parts.join(''))
  }
  return out
}

/** Column letters → zero-based index: A=0, Z=25, AA=26. */
export function columnIndex(ref: string): number {
  const letters = ref.replace(/\d+$/, '')
  let index = 0
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64)
  return index - 1
}

/** Excel serial day → ISO date (1900 system, with the leap-year bug honoured). */
export function excelSerialToIso(serial: number): string {
  const days = Math.floor(serial)
  const epoch = Date.UTC(1899, 11, 30)
  const date = new Date(epoch + days * 86_400_000)
  return date.toISOString().slice(0, 10)
}

/**
 * The first worksheet as rows of strings. Cells that are dates by style are
 * not detectable without the styles part, so serials stay numbers; the
 * marketplace parsers treat a purely numeric "date" column as a serial.
 */
export function readFirstSheet(file: Buffer): string[][] {
  const entries = readZipEntries(file)
  const byName = new Map(entries.map((e) => [e.name, e]))
  const workbook = byName.get('xl/workbook.xml')
  const rels = byName.get('xl/_rels/workbook.xml.rels')
  let sheetPath = 'xl/worksheets/sheet1.xml'
  if (workbook && rels) {
    const wbXml = readZipFile(file, workbook).toString('utf8')
    const relsXml = readZipFile(file, rels).toString('utf8')
    const firstSheet = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wbXml)?.[1]
    if (firstSheet) {
      const target = new RegExp(`<Relationship\\b[^>]*\\bId="${firstSheet}"[^>]*\\bTarget="([^"]+)"`).exec(relsXml)?.[1]
        ?? new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${firstSheet}"`).exec(relsXml)?.[1]
      if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    }
  }
  const sheetEntry = byName.get(sheetPath)
  if (!sheetEntry) throw new Error('ไฟล์ .xlsx นี้ไม่มีชีตให้อ่าน')
  const sheetXml = readZipFile(file, sheetEntry).toString('utf8')
  const stringsEntry = byName.get('xl/sharedStrings.xml')
  const strings = sharedStrings(stringsEntry ? readZipFile(file, stringsEntry).toString('utf8') : null)

  const rows: string[][] = []
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = []
    for (const cell of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1]
      const inner = cell[2] ?? ''
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1]
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1]
      const index = ref ? columnIndex(ref) : cells.length
      let value = ''
      if (type === 's') {
        const idx = Number(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? -1)
        value = strings[idx] ?? ''
      } else if (type === 'inlineStr') {
        value = [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join('')
      } else {
        value = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '')
      }
      while (cells.length < index) cells.push('')
      cells[index] = value
    }
    rows.push(cells)
  }
  return rows
}
