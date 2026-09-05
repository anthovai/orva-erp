import { describe, expect, it } from '@jest/globals'
import { domainOf, guessKind, inferProject, matchCustomer, type Contact, type ProjectRef } from '../emailTriage'

const CC_TECH = 'cc-tech-entity-id'
const TANGS = 'tangs-entity-id'

const contacts: Contact[] = [
  { customerEntityId: CC_TECH, customerName: 'บริษัท ซีซี เทค จำกัด', email: 'somchai@cctech.co.th' },
  { customerEntityId: CC_TECH, customerName: 'บริษัท ซีซี เทค จำกัด', email: 'admin@cctech.co.th' },
  { customerEntityId: TANGS, customerName: 'บริษัท เดอะ แต๊งส์ จำกัด', email: 'owner@gmail.com' },
]

describe('domainOf', () => {
  it('reads the domain, case and space insensitively', () => {
    expect(domainOf('  Somchai@CCTech.co.TH ')).toBe('cctech.co.th')
  })

  it('returns null for anything that is not an address', () => {
    expect(domainOf('not-an-email')).toBeNull()
    expect(domainOf('@nolocalpart.com')).toBeNull()
    expect(domainOf('')).toBeNull()
  })
})

describe('matchCustomer', () => {
  it('matches an exact address regardless of case or padding', () => {
    expect(matchCustomer('  SOMCHAI@cctech.co.th  ', contacts)).toEqual({
      customerEntityId: CC_TECH,
      customerName: 'บริษัท ซีซี เทค จำกัด',
      basis: 'email',
    })
  })

  it('matches an unknown colleague on a known company domain', () => {
    expect(matchCustomer('newhire@cctech.co.th', contacts)).toEqual({
      customerEntityId: CC_TECH,
      customerName: 'บริษัท ซีซี เทค จำกัด',
      basis: 'domain',
    })
  })

  it('never domain-matches a public mail provider', () => {
    // owner@gmail.com is a known contact, but another gmail address is a
    // stranger — sharing gmail.com says nothing about sharing an employer.
    expect(matchCustomer('someone.else@gmail.com', contacts)).toBeNull()
    // the exact address still matches
    expect(matchCustomer('owner@gmail.com', contacts)?.basis).toBe('email')
  })

  it('refuses to guess when two customers share a domain', () => {
    const shared: Contact[] = [
      { customerEntityId: CC_TECH, customerName: 'A', email: 'a@agency.co.th' },
      { customerEntityId: TANGS, customerName: 'B', email: 'b@agency.co.th' },
    ]
    expect(matchCustomer('c@agency.co.th', shared)).toBeNull()
  })

  it('returns null for an unknown domain and for junk input', () => {
    expect(matchCustomer('someone@unknown.co.th', contacts)).toBeNull()
    expect(matchCustomer('', contacts)).toBeNull()
    expect(matchCustomer('garbage', contacts)).toBeNull()
  })
})

describe('inferProject', () => {
  const projects: ProjectRef[] = [
    { quoteId: 'q1', quoteNumber: 'KK-QTN-2026011', customerEntityId: CC_TECH },
    { quoteId: 'q2', quoteNumber: 'KK-QTN-2026022', customerEntityId: CC_TECH },
    { quoteId: 'q3', quoteNumber: 'KK-QTN-2026033', customerEntityId: TANGS },
  ]

  it('honours a quote number quoted in the mail', () => {
    expect(inferProject('เรื่อง KK-QTN-2026022 ขอแก้หน้าแรก', projects, CC_TECH)).toBe('q2')
  })

  it('matches the number case-insensitively', () => {
    expect(inferProject('ref kk-qtn-2026011 please', projects, CC_TECH)).toBe('q1')
  })

  it('honours a quoted number even when the sender is unknown', () => {
    expect(inferProject('KK-QTN-2026033 down', projects, null)).toBe('q3')
  })

  it('refuses when two different projects are quoted', () => {
    expect(inferProject('KK-QTN-2026011 and KK-QTN-2026022', projects, CC_TECH)).toBeNull()
  })

  it('refuses a number that belongs to a different customer than the sender', () => {
    // the sender says CC Tech but the number is The Tangs' — one of the two is
    // wrong, and picking either would spread the error
    expect(inferProject('about KK-QTN-2026033', projects, CC_TECH)).toBeNull()
  })

  it('falls back to the customer’s single project', () => {
    const single = projects.filter((p) => p.customerEntityId === TANGS)
    expect(inferProject('หน้า login พัง', single, TANGS)).toBe('q3')
  })

  it('refuses to pick when the customer has several projects', () => {
    expect(inferProject('หน้า login พัง', projects, CC_TECH)).toBeNull()
  })

  it('returns null with no sender and no quoted number', () => {
    expect(inferProject('hello', projects, null)).toBeNull()
  })

  it('ignores a suspiciously short project number to avoid accidental hits', () => {
    const short: ProjectRef[] = [{ quoteId: 'q9', quoteNumber: 'Q1', customerEntityId: CC_TECH }]
    expect(inferProject('question 1 about pricing', short, null)).toBeNull()
  })
})

describe('guessKind', () => {
  it('reads an outage as an incident', () => {
    expect(guessKind('เว็บล่ม', 'เข้าไม่ได้เลย')).toBe('incident')
    expect(guessKind('URGENT', 'site is down')).toBe('incident')
  })

  it('reads a fault report as a bug', () => {
    expect(guessKind('หน้า login พัง', '')).toBe('bug')
    expect(guessKind('Error on checkout', 'throws an error')).toBe('bug')
  })

  it('reads a request as a change request', () => {
    expect(guessKind('ขอเพิ่มรายงาน', '')).toBe('change_request')
    expect(guessKind('Feature request', 'can you add export')).toBe('change_request')
  })

  it('defaults to a question rather than inflating the bug count', () => {
    expect(guessKind('สอบถามราคา', 'ค่าดูแลรายปีเท่าไหร่')).toBe('question')
    expect(guessKind('', '')).toBe('question')
  })

  it('prefers the more severe reading when a mail says both', () => {
    expect(guessKind('เว็บล่ม และขอเพิ่มฟีเจอร์', '')).toBe('incident')
  })
})
