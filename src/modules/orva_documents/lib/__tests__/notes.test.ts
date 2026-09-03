import { describe, expect, test } from '@jest/globals'
import { buildPrintableDocument, typesForSourceKind, type DocumentSource, type Party } from '../document'

const seller: Party = { name: 'บริษัท ไคเซอร์ ตัวตลก จำกัด', taxId: '0625568000896', branch: 'สำนักงานใหญ่' }
const buyer: Party = { name: 'บริษัท ซีซี เทค จำกัด', taxId: '0105561000123', branch: 'สำนักงานใหญ่' }
const source: DocumentSource = {
  number: 'KKG-CN-2026001', issueDate: '2026-09-04', currencyCode: 'THB',
  lines: [{ description: 'ปรับปรุงมูลค่าตามใบกำกับภาษี KK-INV-2026012', quantity: 1, unitPrice: 2000, amount: 2000 }],
  subtotal: 2000, taxRate: 7, taxAmount: 140, grandTotal: 2140,
  reference: { invoiceNumber: 'KK-INV-2026012', invoiceDate: '2026-08-31', originalAmount: 25680, correctAmount: 23540, difference: 2140, reason: 'C3 — คำนวณราคาผิดพลาด' },
}

describe('credit / debit notes and billing notes', () => {
  test('a credit note is a full tax document carrying the original-invoice reference', () => {
    const doc = buildPrintableDocument({ type: 'credit_note', template: 'brand', seller, buyer, source })
    expect(doc.headingTh).toBe('ใบลดหนี้')
    expect(doc.isTaxDocument).toBe(true)
    expect(doc.isAbbreviated).toBe(false)
    expect(doc.reference?.invoiceNumber).toBe('KK-INV-2026012')
    expect(doc.reference?.difference).toBe(2140)
    expect(doc.warnings).toEqual([])
  })

  test('a note without the buyer tax id is flagged, like any full tax invoice', () => {
    const doc = buildPrintableDocument({ type: 'debit_note', template: 'classic', seller, buyer: { name: 'ลูกค้า', taxId: null }, source })
    expect(doc.headingTh).toBe('ใบเพิ่มหนี้')
    expect(doc.warnings).toContain('buyer_tax_id_missing')
  })

  test('a billing note is not a tax document and prints from an invoice; notes print from a note record', () => {
    const doc = buildPrintableDocument({ type: 'billing_note', template: 'classic', seller, buyer, source: { ...source, reference: null, taxRate: null, taxAmount: 0 } })
    expect(doc.isTaxDocument).toBe(false)
    expect(doc.reference).toBeNull()
    expect(typesForSourceKind('invoice')).toContain('billing_note')
    expect(typesForSourceKind('credit_memo')).toEqual(['credit_note', 'debit_note'])
    expect(typesForSourceKind('quote')).toEqual(['quotation'])
  })
})
