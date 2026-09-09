import { describe, expect, test } from '@jest/globals'
import { DOCUMENT_TYPES, SHAREABLE_TYPES, isShareable } from '../document'
import { expiryFor, shareLinkIsLive } from '../shareLinks'

/**
 * Which documents may be handed out by public link, and when a link stops
 * working. The route and the public endpoint both lean on these two rules.
 */

describe('what may go out by link', () => {
  test('the delivery note may; every statutory tax document may not', () => {
    expect(isShareable('delivery_note')).toBe(true)
    for (const type of ['tax_invoice', 'receipt', 'abbreviated_tax_invoice', 'credit_note', 'debit_note'] as const) {
      expect(isShareable(type)).toBe(false)
    }
  })

  test('a quotation goes through the sales acceptance token, not this door', () => {
    expect(isShareable('quotation')).toBe(false)
  })

  test('the list is deliberately short and every entry is a real type', () => {
    expect(SHAREABLE_TYPES).toEqual(['delivery_note'])
    for (const type of SHAREABLE_TYPES) expect(DOCUMENT_TYPES).toContain(type)
  })
})

describe('when a link is live', () => {
  const now = new Date('2026-09-09T10:00:00Z')

  test('live until its expiry, dead after it, dead once revoked', () => {
    expect(shareLinkIsLive({ expiresAt: '2026-10-10T00:00:00Z', revokedAt: null }, now)).toBe(true)
    expect(shareLinkIsLive({ expiresAt: '2026-09-09T09:59:59Z', revokedAt: null }, now)).toBe(false)
    expect(shareLinkIsLive({ expiresAt: '2026-10-10T00:00:00Z', revokedAt: '2026-09-09T09:00:00Z' }, now)).toBe(false)
  })

  test('no expiry means it lives until revoked', () => {
    expect(shareLinkIsLive({ expiresAt: null, revokedAt: null }, now)).toBe(true)
    expect(shareLinkIsLive({ expiresAt: null, revokedAt: new Date('2026-09-01') }, now)).toBe(false)
  })

  test('a garbage expiry is treated as expired, never as open-ended', () => {
    expect(shareLinkIsLive({ expiresAt: 'not a date', revokedAt: null }, now)).toBe(false)
  })

  test('expiry lands at the end of the last calendar day, like a quote validity', () => {
    // 30 days from 2026-09-09 is 2026-10-09; the link works for the whole of
    // that day and dies at the stroke of the 10th (UTC).
    expect(expiryFor(now, 30).toISOString()).toBe('2026-10-10T00:00:00.000Z')
    expect(expiryFor(now, 1).toISOString()).toBe('2026-09-11T00:00:00.000Z')
  })
})
