import { describe, expect, test } from '@jest/globals'
import { buildQuoteDraft, paymentReminderText } from '../quoteDraft'

describe('quote draft math', () => {
  test('Kaiser quote: 80,000 net → 5,600 VAT, 85,600 gross, 2,400 WHT, 30/40/30 installments sum exactly', () => {
    const draft = buildQuoteDraft(
      [{ description: 'พัฒนาระบบ', quantity: 1, unitPrice: 80000 }],
      { installments: [{ label: 'งวด 1 เริ่มงาน', percent: 30 }, { label: 'งวด 2 ส่งมอบ', percent: 40 }, { label: 'งวด 3 ปิดงาน', percent: 30 }] },
    )
    expect(draft).toMatchObject({ net: 80000, vat: 5600, gross: 85600, wht: 2400, expectedTransfer: 83200 })
    expect(draft.installments.map((i) => i.gross)).toEqual([25680, 34240, 25680])
    expect(draft.installments[0]).toMatchObject({ net: 24000, vat: 1680, wht: 720, expectedTransfer: 24960 })
    expect(draft.installments.reduce((s, i) => s + i.net, 0)).toBe(80000)
  })

  test('rounding residue lands in the last installment; VAT-inclusive prices are backed out', () => {
    const draft = buildQuoteDraft([{ description: 'x', quantity: 3, unitPrice: 33.33 }], { installments: [{ label: 'a', percent: 33 }, { label: 'b', percent: 33 }, { label: 'c', percent: 34 }] })
    expect(draft.net).toBe(99.99)
    expect(draft.installments.reduce((s, i) => s + i.net, 0)).toBeCloseTo(99.99, 2)
    const inclusive = buildQuoteDraft([{ description: 'x', quantity: 1, unitPrice: 107 }], { pricesIncludeVat: true })
    expect(inclusive.net).toBe(100)
    expect(inclusive.gross).toBe(107)
  })

  test('installments must total 100%', () => {
    expect(() => buildQuoteDraft([{ description: 'x', quantity: 1, unitPrice: 1 }], { installments: [{ label: 'a', percent: 50 }] })).toThrow(/100%/)
  })

  test('reminder text names the invoice, amount and overdue days', () => {
    const text = paymentReminderText({ customer: 'บริษัท ซีซี เทค จำกัด', invoiceNumber: 'KKG-INV-2026013', amount: 34240, dueDate: '2026-09-15', daysOverdue: 5, companyName: 'บริษัท ไคเซอร์ ตัวตลก จำกัด', bankLine: 'ธนาคารกสิกรไทย 217-2-81503-3' })
    expect(text).toContain('KKG-INV-2026013')
    expect(text).toContain('34,240.00')
    expect(text).toContain('เกินกำหนด 5 วัน')
    expect(text).toContain('217-2-81503-3')
  })
})
