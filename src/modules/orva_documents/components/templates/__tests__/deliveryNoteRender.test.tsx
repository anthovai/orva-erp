import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from '@jest/globals'
import { buildPrintableDocument, sampleBuyer, sampleDelivery, sampleDeliverySource, type DocumentType, type TemplateId } from '../../../lib/document'
import { templateComponentFor } from '../index'

/**
 * The delivery note has to be right on paper, not just in the model. These
 * render the real templates to HTML — no browser needed, because the sheets
 * are pure React — and read the sheet the way the driver's customer would.
 *
 * The price-hiding assertions are the point: a ใบส่งของ that leaks what the
 * goods cost is the one failure mode that cannot be undone once the paper is
 * handed over.
 */

const seller = { name: 'บริษัท ไคเซอร์ ตัวตลก จำกัด', taxId: '0105566000000', address: 'กรุงเทพฯ', phone: '02-000-0000' }
const t = (_key: string, fallback?: string) => fallback ?? ''

function sheet(args: { type?: DocumentType; template?: TemplateId; showPrices?: boolean; delivery?: ReturnType<typeof sampleDelivery> | null } = {}) {
  const doc = buildPrintableDocument({
    type: args.type ?? 'delivery_note',
    template: args.template ?? 'classic',
    seller,
    buyer: sampleBuyer(),
    source: sampleDeliverySource(),
    delivery: args.delivery === undefined ? sampleDelivery() : args.delivery,
    showPrices: args.showPrices,
    paymentDetails: 'ธนาคารกสิกรไทย 123-4-56789-0',
    terms: 'ชำระภายใน 30 วัน',
  })
  const Template = templateComponentFor(doc)
  return renderToStaticMarkup(<Template doc={doc} t={t} />)
}

describe.each<[TemplateId]>([['classic'], ['modern']])('ใบส่งของ on the %s sheet', (template) => {
  test('states the goods and the delivery, and no money at all', () => {
    const html = sheet({ template })

    // What was delivered, and how much of it.
    expect(html).toContain('ใบส่งของ')
    expect(html).toContain('Marventine Body Lotion 200 มล. (ลัง/24 ขวด)')
    expect(html).toContain('รายการ')
    expect(html).toContain('จำนวน')

    // …and not what it cost. 2,400 is the unit price, 24,000 the line amount,
    // 41,461.50 the gross total — none of them may appear on this sheet.
    expect(html).not.toContain('2,400')
    expect(html).not.toContain('24,000')
    expect(html).not.toContain('41,461.50')
    expect(html).not.toContain('ราคาต่อหน่วย')
    expect(html).not.toContain('จำนวนเงิน')
    expect(html).not.toContain('ภาษีมูลค่าเพิ่ม')
    // The amount in words is the sneakiest leak: it spells the total out.
    expect(html).not.toContain('จำนวนเงินเป็นตัวอักษร')
    expect(html).not.toContain('สี่หมื่น')
    // …and neither does it say how to pay, which is the invoice's job.
    expect(html).not.toContain('การชำระเงิน')
    expect(html).not.toContain('ธนาคารกสิกรไทย')
  })

  test('carries the delivery block and two dated signature lines', () => {
    const html = sheet({ template })
    expect(html).toContain('รายละเอียดการส่งของ')
    expect(html).toContain('สถานที่ส่ง')
    expect(html).toContain('รถบริษัท (ทะเบียน 1กก-1234)')
    expect(html).toContain('คลังสินค้า ประตู 3')
    // Signed by the two people who handled the goods, each line dated.
    expect(html).toContain('ผู้ส่งสินค้า')
    expect(html).toContain('ผู้รับสินค้า')
    expect(html).toContain('วันที่ ......... / ......... / .........')
    // And never a receiver's name printed for them (Q-004).
    expect(html).not.toContain('ผู้รับสินค้า/บริการ')
  })

  test('prints blanks to fill in by hand when nothing has been recorded', () => {
    const html = sheet({ template, delivery: null })
    expect(html).toContain('รายละเอียดการส่งของ')
    expect(html).toContain('วันที่ส่งของ')
    expect(html).toContain('border-dotted')
  })

  test('shows the money once the operator asks for it', () => {
    const html = sheet({ template, showPrices: true })
    expect(html).toContain('ราคาต่อหน่วย')
    expect(html).toContain('2,400')
    expect(html).toContain('จำนวนเงินเป็นตัวอักษร')
    expect(html).toContain('สี่หมื่นหนึ่งพันสี่ร้อยหกสิบสองบาทห้าสิบสตางค์')
  })
})

describe('a delivery note cannot be forced onto the wrong sheet', () => {
  test.each<[TemplateId]>([['brand'], ['compact']])('%s falls back to classic, prices still hidden', (template) => {
    // The preview offers a template picker, so this arrives by hand rather
    // than from settings. brand draws its own money table and compact has no
    // signature block; either would print a wrong ใบส่งของ.
    const html = sheet({ template })
    expect(html).toContain('ใบส่งของ')
    expect(html).toContain('ผู้ส่งสินค้า')
    expect(html).toContain('วันที่ ......... / ......... / .........')
    expect(html).not.toContain('2,400')
    expect(html).not.toContain('จำนวนเงินสุทธิที่ต้องชำระ')
  })
})

describe('the other sheets are unchanged', () => {
  test('an invoice still prints its prices, totals and amount in words', () => {
    const html = sheet({ type: 'invoice', showPrices: false })
    expect(html).toContain('ใบแจ้งหนี้')
    expect(html).toContain('ราคาต่อหน่วย')
    expect(html).toContain('2,400')
    expect(html).toContain('จำนวนเงินเป็นตัวอักษร')
    expect(html).toContain('การชำระเงิน')
    // and carries no delivery block
    expect(html).not.toContain('รายละเอียดการส่งของ')
    expect(html).toContain('ผู้รับสินค้า/บริการ')
  })

  test('a tax invoice still prints the taxpayer id block', () => {
    const html = sheet({ type: 'tax_invoice' })
    expect(html).toContain('เลขประจำตัวผู้เสียภาษี')
    expect(html).toContain('0105566000000')
  })
})
