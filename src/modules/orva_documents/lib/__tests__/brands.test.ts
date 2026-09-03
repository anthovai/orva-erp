import { describe, expect, test } from '@jest/globals'
import { brandForNumber, readActiveBrandCode, reprefixFormat, settingsWithBrand } from '../brands'
import type { DocumentBrand } from '../../data/entities'

const mrv = { code: 'MRV', name: 'Marventine', brandColor: '#8B5E83', logoHeader: 'data:image/png;base64,AAA', logoFooter: null, logoHeaderQuotation: null, paymentDetails: null, documentTerms: 'สินค้าเปลี่ยนคืนได้ภายใน 7 วัน' } as unknown as DocumentBrand

describe('brand profiles', () => {
  test('a document belongs to the brand that prefixes its number; the default series has no brand', () => {
    expect(brandForNumber('MRV-QTN-2026001', [mrv])?.code).toBe('MRV')
    expect(brandForNumber('mrv-inv-2026003', [mrv])?.code).toBe('MRV')
    expect(brandForNumber('KKG-QTN-2026012', [mrv])).toBeNull()
    expect(brandForNumber(null, [mrv])).toBeNull()
  })

  test('the default format is re-prefixed for the brand series', () => {
    expect(reprefixFormat('KKG-QTN-{yyyy}{seq:3}', 'MRV')).toBe('MRV-QTN-{yyyy}{seq:3}')
    expect(reprefixFormat('INV-{yyyy}{mm}{dd}-{seq:5}', 'MRV')).toBe('MRV-{yyyy}{mm}{dd}-{seq:5}')
    expect(reprefixFormat('{yyyy}{seq:4}', 'MRV')).toBe('MRV-{yyyy}{seq:4}')
  })

  test('brand overrides visuals and terms, inherits payment details and keeps the legal seller', () => {
    const settings = { sellerName: 'Kaiser Klowns', brandColor: '#E8352A', logoHeader: 'kaiser', logoFooter: 'kk', logoHeaderQuotation: 'kaiser-q', paymentDetails: 'KBank 217-2-81503-3', documentTerms: 'เงื่อนไข Kaiser' }
    const merged = settingsWithBrand(settings as never, mrv) as unknown as typeof settings
    expect(merged.sellerName).toBe('Kaiser Klowns')
    expect(merged.brandColor).toBe('#8B5E83')
    expect(merged.logoHeader).toBe('data:image/png;base64,AAA')
    expect(merged.logoHeaderQuotation).toBe('data:image/png;base64,AAA')
    expect(merged.logoFooter).toBeNull()
    expect(merged.paymentDetails).toBe('KBank 217-2-81503-3')
    expect(merged.documentTerms).toBe('สินค้าเปลี่ยนคืนได้ภายใน 7 วัน')
    expect(settingsWithBrand(settings as never, null)).toBe(settings)
  })

  test('active brand cookie is read strictly', () => {
    const req = (cookie: string) => new Request('http://x', { headers: { cookie } })
    expect(readActiveBrandCode(req('locale=th; orva_brand=mrv; x=1'))).toBe('MRV')
    expect(readActiveBrandCode(req('orva_brand=%3Cscript%3E'))).toBeNull()
    expect(readActiveBrandCode(req('locale=th'))).toBeNull()
  })
})
