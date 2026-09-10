import { describe, expect, it } from '@jest/globals'
import { replySubject, ticketNoFromSubject } from '../tickets'

describe('a client answer finds its ticket by the number in the subject', () => {
  it('reads the number our emailed reply put there, through Re:/Fwd: and brackets', () => {
    expect(ticketNoFromSubject('Re: [TCK-000123] เว็บล่มตอนเช้า')).toBe('TCK-000123')
    expect(ticketNoFromSubject('FW: Re: TCK-000007 ครับ')).toBe('TCK-000007')
  })

  it('ignores subjects without a ticket number, and look-alikes', () => {
    expect(ticketNoFromSubject('ขอใบเสนอราคา')).toBeNull()
    expect(ticketNoFromSubject('TCK-12 ไม่ครบหลัก')).toBeNull()
    expect(ticketNoFromSubject('ATCK-000123X')).toBeNull()
    expect(ticketNoFromSubject(null)).toBeNull()
  })

  it('titles the outbound reply with the number once, stripping an inbound Re:', () => {
    expect(replySubject('TCK-000123', 'Re: เว็บล่มตอนเช้า')).toBe('Re: [TCK-000123] เว็บล่มตอนเช้า')
    expect(ticketNoFromSubject(replySubject('TCK-000123', 'x'))).toBe('TCK-000123')
  })
})
