import { describe, expect, it } from '@jest/globals'
import { filterContacts, normaliseEmail, pickRecipients, type Contact } from '../audience'
import { newToken, unsubscribeUrl, withUnsubscribeFooter } from '../unsubscribe'

const contact = (over: Partial<Contact>): Contact => ({
  id: over.id ?? 'id', kind: 'person', displayName: 'คุณเอ', email: 'a@example.com',
  consent: true, consentAt: '2026-09-10', consentSource: 'form', ...over,
})

describe('who a broadcast goes to', () => {
  it('sends only to consented contacts with an address, once per address', () => {
    const { recipients, counts } = pickRecipients([
      contact({ id: '1', email: 'A@Example.com' }),
      contact({ id: '2', displayName: 'บริษัท เอ', kind: 'company', email: 'a@example.com' }), // same inbox
      contact({ id: '3', email: 'b@example.com', consent: false }),
      contact({ id: '4', email: null }),
      contact({ id: '5', email: 'c@example.com' }),
    ])
    expect(recipients.map((r) => r.id)).toEqual(['1', '5'])
    expect(recipients[0].email).toBe('a@example.com')
    expect(counts).toEqual({ total: 5, consented: 4, reachable: 2, noEmail: 1, notConsented: 1 })
  })

  it('treats a blank or malformed address as none', () => {
    expect(normaliseEmail('  ')).toBeNull()
    expect(normaliseEmail('not-an-address')).toBeNull()
    expect(normaliseEmail(' Owner@Kaiser.co.th ')).toBe('owner@kaiser.co.th')
  })

  it('search matches the name or the address, case-insensitively', () => {
    const list = [contact({ id: '1', displayName: 'คุณเอ' }), contact({ id: '2', displayName: 'Bee', email: 'bee@x.co' })]
    expect(filterContacts(list, 'BEE').map((c) => c.id)).toEqual(['2'])
    expect(filterContacts(list, 'คุณ').map((c) => c.id)).toEqual(['1'])
    expect(filterContacts(list, '').length).toBe(2)
  })
})

describe('the unsubscribe link', () => {
  it('is unguessable and URL-safe', () => {
    const a = newToken()
    expect(a).not.toBe(newToken())
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/)
  })

  it('points at the public portal page for the organisation', () => {
    expect(unsubscribeUrl('https://erp.kaiser.co.th/', 'kaiser', 'tok_en'))
      .toBe('https://erp.kaiser.co.th/kaiser/portal/unsubscribe/tok_en')
  })

  it('is appended after the body, once, in Thai', () => {
    const text = withUnsubscribeFooter('สวัสดีค่ะ\n\nข่าวใหม่\n\n', 'https://x/unsub')
    expect(text).toBe('สวัสดีค่ะ\n\nข่าวใหม่\n\n---\nหากไม่ต้องการรับข่าวสารจากเรา กดที่นี่: https://x/unsub')
  })
})
