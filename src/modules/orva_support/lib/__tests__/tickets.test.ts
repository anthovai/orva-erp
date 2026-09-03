import { describe, expect, test } from '@jest/globals'
import { ageOf, billableHours, canTransition, queueOrder, stampsFor, ticketNumber } from '../tickets'

describe('support ticket rules', () => {
  test('status machine: reopen from resolved, nothing out of closed', () => {
    expect(canTransition('open', 'in_progress')).toBe(true)
    expect(canTransition('waiting_customer', 'resolved')).toBe(true)
    expect(canTransition('resolved', 'in_progress')).toBe(true)
    expect(canTransition('closed', 'open')).toBe(false)
    expect(canTransition('closed', 'closed')).toBe(true)
  })

  test('timestamps follow the status, and reopening clears the resolution clock', () => {
    const now = new Date('2026-09-04T10:00:00Z')
    expect(stampsFor('resolved', now)).toEqual({ resolvedAt: now, closedAt: null })
    expect(stampsFor('closed', now)).toEqual({ closedAt: now })
    expect(stampsFor('in_progress', now)).toEqual({ resolvedAt: null, closedAt: null })
  })

  test('age stops at resolution; a ticket with no reply is flagged; overdue counts days', () => {
    const now = new Date('2026-09-04T12:00:00Z')
    const open = ageOf({ createdAt: '2026-09-03T12:00:00Z', status: 'open', dueOn: '2026-09-02' }, now)
    expect(open.ageHours).toBe(24)
    expect(open.awaitingFirstResponse).toBe(true)
    expect(open.daysOverdue).toBe(2)
    const done = ageOf({ createdAt: '2026-09-03T12:00:00Z', firstResponseAt: '2026-09-03T14:30:00Z', resolvedAt: '2026-09-04T06:00:00Z', status: 'resolved', dueOn: '2026-09-02' }, now)
    expect(done.ageHours).toBe(18)
    expect(done.responseHours).toBe(2.5)
    expect(done.awaitingFirstResponse).toBe(false)
    expect(done.daysOverdue).toBe(0)
  })

  test('queue puts urgent first, then most overdue, then oldest', () => {
    const rows = [
      { id: 'a', priority: 'normal', daysOverdue: 0, createdAt: '2026-09-01T00:00:00Z' },
      { id: 'b', priority: 'urgent', daysOverdue: 0, createdAt: '2026-09-03T00:00:00Z' },
      { id: 'c', priority: 'normal', daysOverdue: 5, createdAt: '2026-09-02T00:00:00Z' },
    ]
    expect([...rows].sort(queueOrder).map((r) => r.id)).toEqual(['b', 'c', 'a'])
  })

  test('numbering pads to six digits; billable time rounds up to a quarter hour', () => {
    expect(ticketNumber(1)).toBe('TCK-000001')
    expect(ticketNumber(1234)).toBe('TCK-001234')
    expect(billableHours(0)).toBe(0)
    expect(billableHours(5)).toBe(0.25)
    expect(billableHours(30)).toBe(0.5)
    expect(billableHours(95)).toBe(1.75)
  })
})
