import { describe, expect, test } from '@jest/globals'
import { buildPrintableDocument, typesForSourceKind, type DocumentSource, type Party } from '../document'

const employer: Party = { name: 'บริษัท ไคเซอร์ ตัวตลก จำกัด', taxId: '0625568000896', branch: 'สำนักงานใหญ่', address: '16/1 หมู่ 15 ต.อ่างทอง อ.เมือง จ.กำแพงเพชร' }
const employee: Party = { name: 'ธนภัทร ไคเซอร์', taxId: null, address: 'รหัสพนักงาน EMP-0001' }

/** 45,000 salary, 750 social security, 1,200 withheld → 43,050 net. */
const source: DocumentSource = {
  number: 'PRUN-0002-EMP-0001',
  issueDate: '2026-09-30',
  secondaryDate: '2026-09',
  currencyCode: 'THB',
  lines: [
    { description: 'เงินเดือน', quantity: 1, unitPrice: 45000, amount: 45000 },
    { description: 'หัก ประกันสังคม (ลูกจ้าง)', quantity: 1, unitPrice: -750, amount: -750 },
    { description: 'หัก ภาษีเงินได้ ณ ที่จ่าย', quantity: 1, unitPrice: -1200, amount: -1200 },
  ],
  subtotal: 45000,
  taxRate: null,
  taxAmount: 0,
  grandTotal: 43050,
}

describe('payslip', () => {
  test('is not a tax document, needs no taxpayer ids, and totals net pay', () => {
    const doc = buildPrintableDocument({ type: 'payslip', template: 'brand', seller: employer, buyer: employee, source })
    expect(doc.headingTh).toBe('สลิปเงินเดือน')
    expect(doc.isTaxDocument).toBe(false)
    expect(doc.isPayslip).toBe(true)
    expect(doc.warnings).toEqual([])
    expect(doc.taxAmount).toBe(0)
    expect(doc.grandTotal).toBe(43050)
    expect(doc.secondaryDateLabelKey).toBe('orva_documents.field.payPeriod')
    expect(doc.secondaryDate).toBe('2026-09')
  })

  test('earnings and deductions stay separable by sign, and the net is spelled in baht', () => {
    const doc = buildPrintableDocument({ type: 'payslip', template: 'classic', seller: employer, buyer: employee, source })
    const earnings = doc.lines.filter((l) => l.amount >= 0)
    const deductions = doc.lines.filter((l) => l.amount < 0)
    expect(earnings.map((l) => l.amount)).toEqual([45000])
    expect(deductions.reduce((s, l) => s + Math.abs(l.amount), 0)).toBe(1950)
    expect(doc.amountInWords).toContain('บาท')
  })

  test('a payroll line prints only a payslip', () => {
    expect(typesForSourceKind('payroll_line')).toEqual(['payslip'])
    expect(typesForSourceKind('invoice')).not.toContain('payslip')
  })
})
