import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from '@jest/globals'
import { encodeEan13 } from '../../../lib/barcode'
import { buildPrintableDocument, LABEL_COPIES_DEFAULT, sampleLabelSheet, type LabelSheet } from '../../../lib/document'
import { labelDate } from '../label'
import { templateComponentFor } from '../index'

/**
 * T-G3-4 — the label sheet on paper. A label that is missing its อย. number,
 * or prints a date the shelf reads wrongly, is a legal problem, not a visual
 * one, so the sheet is read as HTML the way the render tests read the
 * delivery note.
 */

const seller = { name: 'บริษัท ไคเซอร์ ตัวตลก จำกัด', taxId: '0105566000000', address: 'กรุงเทพฯ' }
const t = (_key: string, fallback?: string) => fallback ?? ''

function sheetHtml(labelSheet: LabelSheet, logoHeader: string | null = null) {
  const doc = buildPrintableDocument({
    type: 'lot_label',
    template: 'classic',
    seller,
    buyer: { name: '' },
    source: { number: 'MV2609A', issueDate: '2026-09-01', currencyCode: 'THB', lines: [], subtotal: 0, taxAmount: 0, grandTotal: 0 },
    logoHeader,
    labelSheet,
  })
  const Template = templateComponentFor(doc)
  return { doc, html: renderToStaticMarkup(<Template doc={doc} t={t} />) }
}

describe('the lot label sheet', () => {
  test('is its own kind of document: no parties, no money, one sheet of 24', () => {
    const sheet = sampleLabelSheet()
    sheet.labels = sheet.labels.map((label) => ({ ...label, barcode: encodeEan13('8859000000013') }))
    const { doc, html } = sheetHtml(sheet)

    expect(doc.isLabelSheet).toBe(true)
    expect(doc.isTaxDocument).toBe(false)
    expect(doc.headingTh).toBe('ฉลากล็อต')
    expect(doc.labelSheet?.labels).toHaveLength(LABEL_COPIES_DEFAULT)
    expect(doc.warnings).toEqual([])

    // 24 labels, each stating what the law wants on it.
    expect((html.match(/อย\. 1012345678/g) ?? []).length).toBe(24)
    expect((html.match(/LOT MV2609A/g) ?? []).length).toBe(24)
    expect((html.match(/MFG 01\/09\/2026/g) ?? []).length).toBe(24)
    expect((html.match(/EXP 01\/09\/2028/g) ?? []).length).toBe(24)
    expect((html.match(/<svg /g) ?? []).length).toBe(24)
    expect(html).toContain('Marventine Body Lotion')
    expect(html).toContain('200 มล.')

    // …and none of what a sales document carries.
    expect(html).not.toContain('ผู้ขาย')
    expect(html).not.toContain('ลูกค้า')
    expect(html).not.toContain('จำนวนเงินรวมทั้งสิ้น')
    expect(html).not.toContain('เลขประจำตัวผู้เสียภาษี')
  })

  test('more copies than a sheet start a new page', () => {
    const { html } = sheetHtml(sampleLabelSheet(30))
    expect((html.match(/LOT MV2609A/g) ?? []).length).toBe(30)
    expect((html.match(/break-before-page/g) ?? []).length).toBe(1)
  })

  test('a missing อย. number is a warning, and the label shows a gap rather than a made-up number', () => {
    const sheet = sampleLabelSheet(3)
    sheet.labels = sheet.labels.map((label) => ({ ...label, fdaNotification: null }))
    const { doc, html } = sheetHtml(sheet)
    expect(doc.warnings).toContain('fda_missing')
    expect((html.match(/อย\. —/g) ?? []).length).toBe(3)
  })

  test('the brand mark prints when the brand profile has one, the brand name otherwise', () => {
    const withMark = sheetHtml(sampleLabelSheet(1), 'data:image/png;base64,AAAA').html
    expect(withMark).toContain('<img src="data:image/png;base64,AAAA"')
    const withoutMark = sheetHtml(sampleLabelSheet(1)).html
    expect(withoutMark).not.toContain('<img')
    expect(withoutMark).toContain('Marventine')
  })

  test('dates print dd/mm/yyyy, and a lot with none prints a dash', () => {
    expect(labelDate('2026-09-01')).toBe('01/09/2026')
    expect(labelDate('2028-02-29')).toBe('29/02/2028')
    expect(labelDate(null)).toBe('—')
  })
})
