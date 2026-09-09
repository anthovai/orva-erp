import { describe, expect, test } from '@jest/globals'
import { deliveryBlockFrom, mergeDeliveryFacts, storedDeliveryFrom } from '../deliveryFacts'

/**
 * The risk in recording delivery facts is not the write — it is losing
 * something else that lives in the same metadata column, or half-erasing the
 * facts while editing one of them.
 */

describe('merging delivery facts into invoice metadata', () => {
  test('keeps every other key in metadata', () => {
    const { metadata } = mergeDeliveryFacts(
      {
        quoteId: 'quote-1',
        customerSnapshot: { customer: { name: 'ลูกค้า' } },
        paidDate: '2026-09-30',
        receivedAmount: 41462.5,
      },
      { deliveredOn: '2026-09-09' },
    )
    // The quote linkage above all: losing it detaches the invoice from the
    // งวด it was issued from.
    expect(metadata.quoteId).toBe('quote-1')
    expect(metadata.customerSnapshot).toEqual({ customer: { name: 'ลูกค้า' } })
    expect(metadata.paidDate).toBe('2026-09-30')
    expect(metadata.receivedAmount).toBe(41462.5)
    expect((metadata.delivery as { deliveredOn: string }).deliveredOn).toBe('2026-09-09')
  })

  test('works on an invoice whose metadata is null or junk', () => {
    expect(mergeDeliveryFacts(null, { deliveredOn: '2026-09-09' }).metadata.delivery).toBeTruthy()
    expect(mergeDeliveryFacts('not json', {}).metadata.delivery).toBeTruthy()
    expect(mergeDeliveryFacts([1, 2], {}).metadata.delivery).toBeTruthy()
  })

  test('an absent field keeps what was recorded before', () => {
    const before = {
      deliveredOn: '2026-09-09',
      carrier: 'รถบริษัท',
      trackingNumbers: ['TH01'],
      address: 'คลังสินค้า ประตู 3',
      note: 'ส่งเช้า',
      showPrices: true,
    }
    // The office adds a second tracking number and touches nothing else.
    const after = storedDeliveryFrom(before, { trackingNumbers: ['TH01', 'TH02'] })
    expect(after).toEqual({ ...before, trackingNumbers: ['TH01', 'TH02'] })
  })

  test('an explicit null or empty string clears a field', () => {
    const before = { deliveredOn: '2026-09-09', carrier: 'รถบริษัท', showPrices: true }
    expect(storedDeliveryFrom(before, { carrier: null }).carrier).toBeNull()
    expect(storedDeliveryFrom(before, { carrier: '   ' }).carrier).toBeNull()
    // …and clearing the carrier does not clear the date
    expect(storedDeliveryFrom(before, { carrier: null }).deliveredOn).toBe('2026-09-09')
    expect(storedDeliveryFrom(before, { showPrices: false }).showPrices).toBe(false)
  })

  test('trims and drops empty tracking numbers — the schema lets them through on purpose', () => {
    const stored = storedDeliveryFrom({}, { trackingNumbers: [' TH01 ', '', '   ', 'TH02'] })
    expect(stored.trackingNumbers).toEqual(['TH01', 'TH02'])
  })

  test('prices stay off unless asked for, on a fresh invoice and a junk one', () => {
    expect(storedDeliveryFrom(undefined, {}).showPrices).toBe(false)
    expect(storedDeliveryFrom({ showPrices: 'yes' }, {}).showPrices).toBe(false)
    expect(storedDeliveryFrom({ showPrices: true }, {}).showPrices).toBe(true)
  })

  test('stores no receiver name, and prints none (Q-004)', () => {
    // Even if a caller slipped one past the route guard into the column, the
    // stored shape has no room for it and the printed block never reads it.
    const stored = storedDeliveryFrom({ deliveredOn: '2026-09-09', receiverName: 'คุณสมชาย ใจดี' }, {})
    expect(Object.keys(stored).sort()).toEqual(['address', 'carrier', 'deliveredOn', 'note', 'showPrices', 'trackingNumbers'])
    expect(JSON.stringify(deliveryBlockFrom(stored))).not.toContain('สมชาย')
    // showPrices is a print flag, not a delivery fact — it does not reach the sheet's block
    expect(Object.keys(deliveryBlockFrom(stored))).not.toContain('showPrices')
  })
})
