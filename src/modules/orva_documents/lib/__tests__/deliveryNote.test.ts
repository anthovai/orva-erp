import io from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from '@jest/globals'
import {
  buildPrintableDocument,
  partyTitlesFor,
  sampleBuyer,
  sampleDelivery,
  sampleDeliverySource,
  sampleSource,
  typesForSourceKind,
  type DeliveryBlock,
} from '../document'
import { deliveryFrom, templateFor } from '../source'
import type { DocumentSettings } from '../../data/entities'

const seller = { name: 'บริษัท ไคเซอร์ ตัวตลก จำกัด', taxId: '0105566000000', address: 'กรุงเทพฯ' }

function note(over: { delivery?: DeliveryBlock | null; showPrices?: boolean } = {}) {
  return buildPrintableDocument({
    type: 'delivery_note',
    template: 'classic',
    seller,
    buyer: sampleBuyer(),
    source: { ...sampleDeliverySource(), number: 'DN-INV-202609-0007' },
    ...over,
  })
}

describe('ใบส่งของ — what the sheet is', () => {
  test('carries the Thai heading and is not a tax document', () => {
    const doc = note()
    expect(doc.headingTh).toBe('ใบส่งของ')
    expect(doc.headingEn).toBe('Delivery Note')
    // Delivering goods claims no VAT, so no taxpayer id is required and the
    // sheet must not be flagged as legally deficient for lacking one.
    expect(doc.isTaxDocument).toBe(false)
    expect(doc.warnings).toEqual([])
    expect(doc.isDeliveryNote).toBe(true)
  })

  test('labels the two parties by who handled the goods, not who sold them', () => {
    expect(partyTitlesFor('delivery_note')).toMatchObject({ issuerTh: 'ผู้ส่งสินค้า', counterpartyTh: 'ผู้รับสินค้า' })
  })

  test('prints only from an invoice', () => {
    expect(typesForSourceKind('invoice')).toContain('delivery_note')
    expect(typesForSourceKind('quote')).not.toContain('delivery_note')
    expect(typesForSourceKind('purchase_order')).not.toContain('delivery_note')
  })
})

describe('ใบส่งของ — money', () => {
  test('hides prices unless the operator asks for them', () => {
    expect(note().showPrices).toBe(false)
    expect(note({ showPrices: true }).showPrices).toBe(true)
  })

  test('says no amount in words while prices are hidden', () => {
    // The figures are still in the model — the sheet keeps the quantities and
    // the templates drop the money columns — but an amount spelled out in
    // baht at the foot would defeat hiding them.
    expect(note().amountInWords).toBeNull()
    expect(note({ showPrices: true }).amountInWords).toContain('บาท')
    expect(note().lines[0].amount).toBeGreaterThan(0)
  })

  test('every other type prints prices whatever the flag says', () => {
    const invoice = buildPrintableDocument({
      type: 'invoice',
      template: 'classic',
      seller,
      buyer: sampleBuyer(),
      source: sampleSource(),
      showPrices: false,
    })
    expect(invoice.showPrices).toBe(true)
    expect(invoice.delivery).toBeNull()
  })
})

describe('ใบส่งของ — the delivery block', () => {
  test('is present even before any fact is recorded, so the form can be filled by hand', () => {
    expect(note().delivery).toEqual({ deliveredOn: null })
  })

  test('the recorded delivery date becomes the sheet’s second date', () => {
    const doc = note({ delivery: sampleDelivery() })
    expect(doc.secondaryDate).toBe('2026-09-09')
    expect(doc.secondaryDateLabelKey).toBe('orva_documents.field.deliveredOn')
  })

  test('reads the facts off metadata and falls back through the addresses', () => {
    // Recorded delivery address wins…
    const recorded = deliveryFrom({
      delivery: { deliveredOn: '2026-09-09', carrier: 'รถบริษัท', address: 'คลังสินค้า ประตู 3', showPrices: true, trackingNumbers: ['TH01', ' '] },
      shipping_address_snapshot: { addressLine1: 'โกดังลูกค้า', city: 'สมุทรปราการ' },
      billing_address_snapshot: { addressLine1: 'สำนักงานใหญ่' },
    })
    expect(recorded.delivery.address).toBe('คลังสินค้า ประตู 3')
    expect(recorded.delivery.trackingNumbers).toEqual(['TH01'])
    expect(recorded.showPrices).toBe(true)

    // …then the shipping address, because goods go to a warehouse…
    const shipped = deliveryFrom({
      delivery: {},
      shipping_address_snapshot: { addressLine1: 'โกดังลูกค้า', city: 'สมุทรปราการ' },
      billing_address_snapshot: { addressLine1: 'สำนักงานใหญ่' },
    })
    expect(shipped.delivery.address).toBe('โกดังลูกค้า สมุทรปราการ')

    // …and the billing address only when nothing better is known.
    const billed = deliveryFrom({ billing_address_snapshot: { addressLine1: 'สำนักงานใหญ่' } })
    expect(billed.delivery.address).toBe('สำนักงานใหญ่')
    expect(billed.delivery.deliveredOn).toBeNull()
    expect(billed.showPrices).toBe(false)
  })

  test('never carries a receiver’s name, whatever is in the metadata (Q-004)', () => {
    // sales_invoices.metadata is NOT encrypted at rest, so a third party's
    // name must not be stored there. Even if something wrote one, the sheet
    // does not read it: the paper is signed by hand.
    const read = deliveryFrom({ delivery: { deliveredOn: '2026-09-09', receiverName: 'คุณสมชาย ใจดี' } })
    expect(JSON.stringify(read.delivery)).not.toContain('สมชาย')
    expect(Object.keys(read.delivery).sort()).toEqual(['address', 'carrier', 'deliveredOn', 'note', 'trackingNumbers'])
  })
})

describe('ใบส่งของ — template choice', () => {
  const settings = (templateInvoice: string) => ({ templateInvoice, templateQuotation: 'classic', templateTaxInvoice: 'classic', templateReceipt: 'classic' } as unknown as DocumentSettings)

  test('follows the invoice when the invoice template can print it', () => {
    expect(templateFor('delivery_note', settings('modern'))).toBe('modern')
    expect(templateFor('delivery_note', settings('classic'))).toBe('classic')
  })

  test('refuses the brand and compact forms', () => {
    // brand is the tenant's ORIGINAL TAX INVOICE and ends in "จำนวนเงินสุทธิ
    // ที่ต้องชำระ"; compact has no signature block. A delivery note demands
    // no payment and must be signed, so both would print a wrong document.
    expect(templateFor('delivery_note', settings('brand'))).toBe('classic')
    expect(templateFor('delivery_note', settings('compact'))).toBe('classic')
    // …while the invoice itself still prints exactly as configured.
    expect(templateFor('invoice', settings('brand'))).toBe('brand')
  })
})

describe('i18n parity (TEST-014)', () => {
  const load = (locale: string) =>
    JSON.parse(io.readFileSync(path.join(__dirname, '..', '..', 'i18n', `${locale}.json`), 'utf8')) as Record<string, string>

  test('th and en carry the same keys', () => {
    const th = Object.keys(load('th')).sort()
    const en = Object.keys(load('en')).sort()
    expect(th).toEqual(en)
  })

  test('every delivery key is translated in both locales', () => {
    const th = load('th')
    const en = load('en')
    const keys = [
      'orva_documents.type.delivery_note',
      'orva_documents.field.deliveredOn',
      'orva_documents.field.consignor',
      'orva_documents.field.consignee',
      'orva_documents.field.signatureConsignor',
      'orva_documents.field.signatureConsignee',
      'orva_documents.delivery.title',
      'orva_documents.delivery.deliveredOn',
      'orva_documents.delivery.carrier',
      'orva_documents.delivery.address',
      'orva_documents.delivery.tracking',
      'orva_documents.delivery.note',
      'orva_documents.delivery.signedOn',
      'orva_documents.delivery.action',
    ]
    // Reported as lists so a failure names the missing keys — jest's expect
    // takes no message argument (that is Playwright's expect).
    expect(keys.filter((key) => !th[key])).toEqual([])
    expect(keys.filter((key) => !en[key])).toEqual([])
    expect(th['orva_documents.type.delivery_note']).toBe('ใบส่งของ')
  })
})
