import { describe, expect, test } from '@jest/globals'
import { matchSlipToInvoices, parseThaiAmount, parseThaiDate, withholdingFor } from '../slipMatch'

const kaiser = { id: 'inv1', number: 'KK-INV-2026012', customer: 'บริษัท ซีซี เทค จำกัด', net: 24000, gross: 25680, remaining: 25680, dueDate: '2026-09-15' }
const other = { id: 'inv2', number: 'KKG-INV-2026013', customer: 'ลูกค้า ข', net: 100000, gross: 107000, remaining: 107000, dueDate: null }

describe('slip → receipt matching', () => {
  test('a transfer of gross minus 3% WHT is a full settlement with WHT, not a short payment', () => {
    const [best] = matchSlipToInvoices(24960, [other, kaiser])
    expect(best.invoiceNumber).toBe('KK-INV-2026012')
    expect(best.kind).toBe('full_less_wht')
    expect(best.wht).toBe(720)
    expect(best.cashReceived).toBe(24960)
    expect(withholdingFor(24000)).toBe(720)
  })

  test('an exact gross transfer outranks everything; partials rank by closeness; overpayments are not candidates', () => {
    const ranked = matchSlipToInvoices(25680, [kaiser, other])
    expect(ranked[0]).toMatchObject({ invoiceNumber: 'KK-INV-2026012', kind: 'full', score: 1 })
    expect(ranked[1]).toMatchObject({ invoiceNumber: 'KKG-INV-2026013', kind: 'partial' })
    expect(matchSlipToInvoices(200000, [kaiser, other])).toHaveLength(0)
  })

  test('amount parsing survives Thai slip formatting', () => {
    expect(parseThaiAmount('จำนวนเงิน 24,960.00 บาท')).toBe(24960)
    expect(parseThaiAmount('฿25,680.-')).toBe(25680)
    expect(parseThaiAmount('ไม่มีตัวเลข')).toBeNull()
  })

  test('date parsing handles Buddhist years and Thai month abbreviations', () => {
    expect(parseThaiDate('31 ส.ค. 69 14:02')).toBe('2026-08-31')
    expect(parseThaiDate('31/08/2569')).toBe('2026-08-31')
    expect(parseThaiDate('2026-09-01T10:00')).toBe('2026-09-01')
    expect(parseThaiDate('1 Sep 2026')).toBe('2026-09-01')
    expect(parseThaiDate('วันที่ไม่ชัด')).toBeNull()
  })
})
