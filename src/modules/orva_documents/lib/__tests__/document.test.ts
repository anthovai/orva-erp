import { describe, expect, test } from '@jest/globals'
import { bahtText, readThaiInteger } from '../bahtText'
import { buildPrintableDocument, sampleBuyer, sampleSource } from '../document'

describe('readThaiInteger', () => {
  test.each([
    [0, 'ศูนย์'],
    [1, 'หนึ่ง'],
    [10, 'สิบ'],
    [11, 'สิบเอ็ด'],
    [20, 'ยี่สิบ'],
    [21, 'ยี่สิบเอ็ด'],
    [100, 'หนึ่งร้อย'],
    [101, 'หนึ่งร้อยเอ็ด'],
    [1000, 'หนึ่งพัน'],
    [12345, 'หนึ่งหมื่นสองพันสามร้อยสี่สิบห้า'],
    [1000000, 'หนึ่งล้าน'],
    // เอ็ด applies whenever a units-place 1 follows another non-zero digit,
    // the same rule that makes 1,001 หนึ่งพันเอ็ด — it carries across ล้าน too.
    [1000001, 'หนึ่งล้านเอ็ด'],
    [2500000, 'สองล้านห้าแสน'],
  ])('%i reads as %s', (value, expected) => {
    expect(readThaiInteger(value as number)).toBe(expected)
  })
})

describe('bahtText', () => {
  test('whole amounts end ถ้วน', () => {
    expect(bahtText(100)).toBe('หนึ่งร้อยบาทถ้วน')
    expect(bahtText(0)).toBe('ศูนย์บาทถ้วน')
  })
  test('satang are spelled out', () => {
    expect(bahtText(1234.5)).toBe('หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์')
    expect(bahtText(0.25)).toBe('ศูนย์บาทยี่สิบห้าสตางค์')
  })
  test('rounds to satang rather than dropping fractions', () => {
    expect(bahtText(10.005)).toBe('สิบบาทหนึ่งสตางค์')
  })
  test('negative amounts are marked', () => {
    expect(bahtText(-5)).toBe('ลบห้าบาทถ้วน')
  })
})

describe('buildPrintableDocument', () => {
  const seller = {
    name: 'บริษัท แอนโธวาย จำกัด',
    taxId: '0105566000111',
    branch: 'สำนักงานใหญ่',
  }

  test('quotation carries the Thai heading and a validity date, and is not a tax document', () => {
    const doc = buildPrintableDocument({
      type: 'quotation', template: 'classic', seller, buyer: sampleBuyer(), source: sampleSource(),
    })
    expect(doc.headingTh).toBe('ใบเสนอราคา')
    expect(doc.isTaxDocument).toBe(false)
    expect(doc.secondaryDateLabelKey).toBe('orva_documents.field.validUntil')
    expect(doc.warnings).toEqual([])
  })

  test('tax invoice is a tax document and spells the total', () => {
    const doc = buildPrintableDocument({
      type: 'tax_invoice', template: 'classic', seller, buyer: sampleBuyer(), source: sampleSource(),
    })
    expect(doc.headingTh).toBe('ใบกำกับภาษี')
    expect(doc.isTaxDocument).toBe(true)
    expect(doc.amountInWords).toContain('บาท')
    expect(doc.secondaryDateLabelKey).toBeNull()
  })

  test('a foreign-currency total is not spelled out as baht', () => {
    const doc = buildPrintableDocument({
      type: 'tax_invoice',
      template: 'classic',
      seller,
      buyer: sampleBuyer(),
      source: { ...sampleSource(), currencyCode: 'USD' },
    })
    // bahtText would read a USD figure as บาท, contradicting the total beside
    // it. No words is correct; wrong words on a tax document is not.
    expect(doc.amountInWords).toBeNull()
  })

  test('a tax document without taxpayer ids reports why it is deficient', () => {
    const doc = buildPrintableDocument({
      type: 'tax_invoice',
      template: 'classic',
      seller: { name: 'ยังไม่ได้ตั้งค่า' },
      buyer: { name: 'ลูกค้ารายย่อย' },
      source: sampleSource(),
    })
    expect(doc.warnings).toContain('seller_tax_id_missing')
    expect(doc.warnings).toContain('buyer_tax_id_missing')
  })

  test('a quotation without taxpayer ids is fine — it is not statutory', () => {
    const doc = buildPrintableDocument({
      type: 'quotation',
      template: 'modern',
      seller: { name: 'ผู้ขาย' },
      buyer: { name: 'ผู้ซื้อ' },
      source: sampleSource(),
    })
    expect(doc.warnings).toEqual([])
  })

  test('presents the stored tax rather than recomputing it', () => {
    const source = { ...sampleSource(), taxAmount: 1, taxRate: 7, grandTotal: 999 }
    const doc = buildPrintableDocument({
      type: 'invoice', template: 'compact', seller, buyer: sampleBuyer(), source,
    })
    expect(doc.taxAmount).toBe(1)
    expect(doc.grandTotal).toBe(999)
  })

  test('payment method only prints on a receipt', () => {
    const source = { ...sampleSource(), paymentMethod: 'เงินโอน' }
    const receipt = buildPrintableDocument({ type: 'receipt', template: 'classic', seller, buyer: sampleBuyer(), source })
    const invoice = buildPrintableDocument({ type: 'invoice', template: 'classic', seller, buyer: sampleBuyer(), source })
    expect(receipt.paymentMethod).toBe('เงินโอน')
    expect(invoice.paymentMethod).toBeNull()
  })

  test('a receipt is issued as the combined tax invoice / receipt form', () => {
    const doc = buildPrintableDocument({
      type: 'receipt', template: 'classic', seller, buyer: sampleBuyer(), source: sampleSource(),
    })
    // Thai practice issues one sheet when payment is taken on issue, so the
    // receipt carries the statutory heading and both taxpayer ids rather than
    // being a bare acknowledgement of payment.
    expect(doc.headingTh).toBe('ใบกำกับภาษี/ใบเสร็จรับเงิน')
    expect(doc.isTaxDocument).toBe(true)
    expect(doc.secondaryDateLabelKey).toBe('orva_documents.field.paidDate')
  })
})
