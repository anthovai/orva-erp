import { describe, expect, test } from '@jest/globals'
import { buildCogsJournalLines, buildValuation, expiryFromShelfLife, splitVatInclusive, unitCostFromBillLine } from '../valuation'

const lot = (id: string, onHand: number, unitCost: number | null, expiresAt: string | null) =>
  ({ lotId: id, variantId: 'v1', variantName: 'Marventine Body Lotion 250ml', sku: 'MRV-BL-250', lotNumber: id.toUpperCase(), expiresAt, onHand, unitCost })

describe('Marventine stock valuation', () => {
  test('values each lot at its own cost, flags expiry and sorts soonest first', () => {
    const v = buildValuation('2026-09-03', [
      lot('b', 100, 60, '2028-01-31'),
      lot('a', 40, 62.5, '2026-11-15'),
      lot('c', 0, 60, '2027-01-01'),
      lot('d', 5, null, null),
      lot('e', 3, 60, '2026-08-01'),
    ])
    expect(v.lines.map((l) => l.lotId)).toEqual(['e', 'a', 'b', 'd'])
    expect(v.totalOnHand).toBe(148)
    expect(v.totalValue).toBe(100 * 60 + 40 * 62.5 + 3 * 60)
    expect(v.uncosted).toBe(1)
    expect(v.expiringSoon).toBe(1)
    expect(v.expired).toBe(1)
  })

  test('bill line → unit cost, shelf life → expiry with month clamp', () => {
    expect(unitCostFromBillLine(12000, 200)).toBe(60)
    expect(unitCostFromBillLine(10000, 3)).toBe(3333.3333)
    expect(() => unitCostFromBillLine(100, 0)).toThrow()
    expect(expiryFromShelfLife('2026-09-03', 24)).toBe('2028-09-03')
    expect(expiryFromShelfLife('2026-01-31', 1)).toBe('2026-02-28')
  })

  test('COGS journal is one balanced Dr COGS / Cr Inventory pair', () => {
    const { lines, total } = buildCogsJournalLines([{ quantity: 10, unitCost: 60 }, { quantity: 2, unitCost: 62.5 }], 'cogs', 'inv')
    expect(total).toBe(725)
    expect(lines[0]).toMatchObject({ accountId: 'cogs', debit: '725.0000', credit: '0.0000' })
    expect(lines[1]).toMatchObject({ accountId: 'inv', debit: '0.0000', credit: '725.0000' })
    expect(() => buildCogsJournalLines([], 'cogs', 'inv')).toThrow(/nothing/)
  })

  test('shelf price 590 splits into 551.40 net + 38.60 VAT', () => {
    expect(splitVatInclusive(590)).toEqual({ net: 551.4, vat: 38.6, gross: 590 })
  })
})
