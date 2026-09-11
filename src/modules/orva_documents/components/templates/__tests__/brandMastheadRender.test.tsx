import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from '@jest/globals'
import { buildPrintableDocument, sampleBuyer, sampleDeliverySource, type DocumentType } from '../../../lib/document'
import { templateComponentFor } from '../index'

/**
 * Whose paper is this? — the masthead of the brand sheet.
 *
 * One legal entity trades under several names (ANT → Anthovai, MRV →
 * Marventine). A customer should remember the brand; the Revenue Department
 * needs the company. The rule these tests hold:
 *
 *  - commercial paper (ใบเสนอราคา, ใบแจ้งหนี้) leads with the TRADING name and
 *    names the company under it as "โดย …", so the recipient can always tell
 *    which company is on the hook;
 *  - a statutory ใบกำกับภาษี / ใบเสร็จ leads with the REGISTERED name and its
 *    taxpayer id — the identity the form is about — with the brand kept as a
 *    secondary line;
 *  - a document in the company's own number series prints no brand at all.
 *
 * Before this, a brand's logo REPLACED the name: an Anthovai quotation showed
 * a gold monogram and no company name anywhere, and the word "Anthovai" was
 * nowhere on the sheet either.
 */

const seller = {
  name: 'KAISER KLOWNS GROUPS',
  legalName: 'บริษัท ไคเซอร์ ตัวตลก จำกัด',
  taxId: '0625568000896',
  branch: 'สำนักงานใหญ่',
  address: '16/1 หมู่ที่ 15 ตำบลอ่างทอง อำเภอเมืองกำแพงเพชร จ.กำแพงเพชร 62000',
  phone: '095-354-0430',
}
const t = (_key: string, fallback?: string) => fallback ?? ''

// A 1x1 gif: the masthead only branches on "is there a logo", not on its pixels.
const LOGO = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='

function sheet(args: { type: DocumentType; brandName?: string | null; logo?: boolean }) {
  const doc = buildPrintableDocument({
    type: args.type,
    template: 'brand',
    seller,
    buyer: sampleBuyer(),
    source: sampleDeliverySource(),
    brandName: args.brandName ?? null,
    logoHeader: args.logo === false ? null : LOGO,
    accentColor: '#91722f',
  })
  const Template = templateComponentFor(doc)
  return renderToStaticMarkup(<Template doc={doc} t={t} />)
}

describe('commercial paper leads with the trading name', () => {
  test.each<[DocumentType]>([['quotation'], ['invoice']])('%s names the brand and the company that issues it', (type) => {
    const html = sheet({ type, brandName: 'Anthovai' })
    expect(html).toContain('Anthovai')
    // The company is named, and named as the issuer rather than as a heading.
    expect(html).toContain('โดย')
    expect(html).toContain('บริษัท ไคเซอร์ ตัวตลก จำกัด')
    expect(html).toContain('จ.กำแพงเพชร 62000')
    // A quotation is not a tax document: no taxpayer id block on the seller.
    expect(html).not.toContain('0625568000896')
  })

  test('the logo is described by the brand, not by a stale display name', () => {
    const html = sheet({ type: 'quotation', brandName: 'Anthovai' })
    expect(html).toContain('alt="Anthovai"')
    expect(html).not.toContain('alt="KAISER KLOWNS GROUPS"')
  })
})

describe('statutory paper leads with the registered name', () => {
  test.each<[DocumentType]>([['tax_invoice'], ['receipt']])('%s carries the legal name and taxpayer id', (type) => {
    const html = sheet({ type, brandName: 'Anthovai' })
    expect(html).toContain('บริษัท ไคเซอร์ ตัวตลก จำกัด')
    expect(html).toContain('เลขประจำตัวผู้เสียภาษี')
    expect(html).toContain('0625568000896')
    expect(html).toContain('สำนักงานใหญ่')
    // the brand may stay on the sheet, but it does not stand in for the company
    expect(html).toContain('Anthovai')
    expect(html).not.toContain('โดย บริษัท')
  })
})

describe("the company's own series prints no brand", () => {
  test('a quotation with no brand still names the company', () => {
    const html = sheet({ type: 'quotation', brandName: null })
    expect(html).toContain('บริษัท ไคเซอร์ ตัวตลก จำกัด')
    expect(html).not.toContain('Anthovai')
    expect(html).not.toContain('โดย')
  })

  test('with no logo either, the display name is the masthead', () => {
    const html = sheet({ type: 'quotation', brandName: null, logo: false })
    expect(html).toContain('KAISER KLOWNS GROUPS')
  })
})
