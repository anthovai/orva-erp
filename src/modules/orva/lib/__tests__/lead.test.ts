import { describe, expect, it } from '@jest/globals'
import {
  DEDUPE_WINDOW_MS, DEFAULT_LEAD_SOURCE, isDuplicateWithin, leadDescription, leadTitle,
  looksLikeBot, normaliseEmail, normaliseSource,
} from '../lead'

describe('normaliseSource', () => {
  it('keeps a value the select actually offers', () => {
    expect(normaliseSource('LINE')).toBe('LINE')
    expect(normaliseSource('เพื่อนแนะนำ/ปากต่อปาก')).toBe('เพื่อนแนะนำ/ปากต่อปาก')
  })

  it('defaults an empty channel to the website', () => {
    expect(normaliseSource(undefined)).toBe(DEFAULT_LEAD_SOURCE)
    expect(normaliseSource(null)).toBe(DEFAULT_LEAD_SOURCE)
    expect(normaliseSource('')).toBe(DEFAULT_LEAD_SOURCE)
  })

  it('folds anything off the list into อื่นๆ so the pipeline filter still sees it', () => {
    expect(normaliseSource('TikTok')).toBe('อื่นๆ')
    expect(normaliseSource('<script>alert(1)</script>')).toBe('อื่นๆ')
  })

  it('tolerates surrounding whitespace', () => {
    expect(normaliseSource('  Facebook  ')).toBe('Facebook')
  })
})

describe('normaliseEmail', () => {
  it('lowercases and trims so one person is one person', () => {
    expect(normaliseEmail('  Somchai@CCTech.co.TH ')).toBe('somchai@cctech.co.th')
  })
})

describe('leadTitle', () => {
  it('prefers the company', () => {
    expect(leadTitle({ name: 'สมชาย', company: 'บริษัท ซีซี เทค จำกัด' })).toBe('บริษัท ซีซี เทค จำกัด')
  })

  it('falls back to the person when no company is given', () => {
    expect(leadTitle({ name: ' สมชาย ', company: '   ' })).toBe('สมชาย')
    expect(leadTitle({ name: 'สมชาย' })).toBe('สมชาย')
  })

  it('never exceeds the deal title limit', () => {
    expect(leadTitle({ name: 'x'.repeat(500) })).toHaveLength(200)
  })
})

describe('leadDescription', () => {
  it('carries every contact detail the owner needs to reply', () => {
    const body = leadDescription({
      name: 'สมชาย', email: 'Somchai@CCTech.co.th', company: 'ซีซี เทค', phone: '095-354-0430',
      message: 'อยากได้เว็บใหม่', source: 'LINE',
    })
    expect(body).toContain('ชื่อ: สมชาย')
    expect(body).toContain('อีเมล: somchai@cctech.co.th')
    expect(body).toContain('บริษัท: ซีซี เทค')
    expect(body).toContain('โทร: 095-354-0430')
    expect(body).toContain('ช่องทางที่มา: LINE')
    expect(body).toContain('อยากได้เว็บใหม่')
  })

  it('omits the lines that were left blank', () => {
    const body = leadDescription({ name: 'สมชาย', email: 'a@b.co', source: 'เว็บไซต์' })
    expect(body).not.toContain('บริษัท:')
    expect(body).not.toContain('โทร:')
  })

  it('stays within the description limit', () => {
    const body = leadDescription({ name: 'ก', email: 'a@b.co', message: 'x'.repeat(9000), source: 'เว็บไซต์' })
    expect(body.length).toBeLessThanOrEqual(4000)
  })
})

describe('isDuplicateWithin', () => {
  const now = new Date('2026-09-05T12:00:00Z')

  it('treats a resubmission minutes later as the same lead', () => {
    expect(isDuplicateWithin(new Date('2026-09-05T11:58:00Z'), now)).toBe(true)
  })

  it('lets a genuine second enquiry through after the window', () => {
    expect(isDuplicateWithin(new Date('2026-09-04T11:00:00Z'), now)).toBe(false)
  })

  it('is not tripped by a first-ever submission', () => {
    expect(isDuplicateWithin(null, now)).toBe(false)
    expect(isDuplicateWithin(undefined, now)).toBe(false)
  })

  it('ignores an unparseable timestamp rather than swallowing the lead', () => {
    expect(isDuplicateWithin('not-a-date', now)).toBe(false)
  })

  it('does not treat a future timestamp as a duplicate', () => {
    expect(isDuplicateWithin(new Date(now.getTime() + 60_000), now)).toBe(false)
  })

  it('uses a 24 hour window by default', () => {
    expect(isDuplicateWithin(new Date(now.getTime() - DEDUPE_WINDOW_MS + 1000), now)).toBe(true)
    expect(isDuplicateWithin(new Date(now.getTime() - DEDUPE_WINDOW_MS - 1000), now)).toBe(false)
  })
})

describe('looksLikeBot', () => {
  it('flags a filled honeypot', () => {
    expect(looksLikeBot('http://spam.example')).toBe(true)
  })

  it('passes a human who left it alone', () => {
    expect(looksLikeBot('')).toBe(false)
    expect(looksLikeBot('   ')).toBe(false)
    expect(looksLikeBot(undefined)).toBe(false)
    expect(looksLikeBot(null)).toBe(false)
  })
})
