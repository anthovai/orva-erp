/**
 * Thai baht text (คำอ่านจำนวนเงิน) — every Thai business document carries the
 * amount spelled out, and accountants check it against the figures.
 *
 * Rules that make this non-obvious:
 *  - 1 in the tens place reads เอ็ด, not หนึ่ง (21 = ยี่สิบเอ็ด)
 *  - 2 in the tens place reads ยี่, not สอง (20 = ยี่สิบ)
 *  - the tens digit 1 reads สิบ, not หนึ่งสิบ (10 = สิบ)
 *  - groups of six digits repeat with ล้าน (1,000,000 = หนึ่งล้าน)
 *  - a whole amount ends ถ้วน; otherwise satang are appended as สตางค์
 */

const DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า']
const PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน']

/** Reads an integer of at most six digits (one ล้าน group). */
function readGroup(group: string): string {
  const length = group.length
  let out = ''
  for (let index = 0; index < length; index++) {
    const digit = Number(group[index])
    const place = length - index - 1
    if (digit === 0) continue
    if (place === 0 && digit === 1 && length > 1) {
      out += 'เอ็ด'
    } else if (place === 1 && digit === 1) {
      out += 'สิบ'
    } else if (place === 1 && digit === 2) {
      out += 'ยี่สิบ'
    } else {
      out += DIGITS[digit] + PLACES[place]
    }
  }
  return out
}

/** Reads a non-negative integer of any size, chunking by ล้าน. */
export function readThaiInteger(value: number): string {
  const whole = Math.floor(Math.abs(value))
  if (whole === 0) return DIGITS[0]
  const text = String(whole)
  // split into six-digit groups from the right
  const groups: string[] = []
  for (let end = text.length; end > 0; end -= 6) {
    groups.unshift(text.slice(Math.max(0, end - 6), end))
  }
  return groups
    .map((group, index) => {
      const read = readGroup(group)
      if (!read) return ''
      const millionSuffix = 'ล้าน'.repeat(groups.length - index - 1)
      return read + millionSuffix
    })
    .join('')
}

/**
 * Full baht text for a money amount, e.g. 1234.50 →
 * "หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์".
 */
export function bahtText(amount: number): string {
  if (!Number.isFinite(amount)) return ''
  const negative = amount < 0
  const absolute = Math.abs(amount)
  // round to satang first so 0.005 does not read as zero satang
  const totalSatang = Math.round(absolute * 100)
  const baht = Math.floor(totalSatang / 100)
  const satang = totalSatang % 100

  const bahtPart = `${readThaiInteger(baht)}บาท`
  const tail = satang === 0 ? 'ถ้วน' : `${readThaiInteger(satang)}สตางค์`
  return `${negative ? 'ลบ' : ''}${bahtPart}${tail}`
}
