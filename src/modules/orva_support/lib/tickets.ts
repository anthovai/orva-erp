/**
 * Pure ticket rules: numbering format, the status machine, ageing and the
 * response/resolution clock. Kept IO-free so the behaviour is unit-tested
 * without a database.
 */
export type TicketStatus = 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed'

/** Which statuses one can move to — a resolved ticket may reopen, a closed one may not. */
export const STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ['in_progress', 'waiting_customer', 'resolved', 'closed'],
  in_progress: ['waiting_customer', 'resolved', 'open', 'closed'],
  waiting_customer: ['in_progress', 'resolved', 'open', 'closed'],
  resolved: ['closed', 'in_progress'],
  closed: [],
}

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return from === to || STATUS_TRANSITIONS[from].includes(to)
}

/** Timestamps a status change implies, so the clock is never set by hand. */
export function stampsFor(to: TicketStatus, now: Date): { resolvedAt?: Date | null; closedAt?: Date | null } {
  if (to === 'resolved') return { resolvedAt: now, closedAt: null }
  if (to === 'closed') return { closedAt: now }
  // reopening clears the resolution clock
  return { resolvedAt: null, closedAt: null }
}

export const ticketNumber = (sequence: number) => `TCK-${String(sequence).padStart(6, '0')}`

/**
 * The ticket a customer's email is about, read off its subject.
 *
 * Our outbound reply is sent through Resend, so the `Message-ID` the client
 * answers to is one we never see; `In-Reply-To` cannot find the ticket. The
 * subject can: every reply we send is titled `Re: [TCK-000123] …`, and mail
 * clients keep that when the client answers. First match wins.
 */
export function ticketNoFromSubject(subject: string | null | undefined): string | null {
  const match = /\bTCK-(\d{6})\b/.exec(subject ?? '')
  return match ? `TCK-${match[1]}` : null
}

/** The subject an emailed reply carries — the ticket number the inbox matches on, then the ticket's own title. */
export const replySubject = (ticketNo: string, subject: string) =>
  `Re: [${ticketNo}] ${subject.replace(/^\s*(re|fw|fwd)\s*:\s*/i, '').trim()}`.slice(0, 500)

const HOURS = 36e5

/** How long the ticket has been waiting, and whether it is past its due date. */
export function ageOf(ticket: { createdAt: Date | string; firstResponseAt?: Date | string | null; resolvedAt?: Date | string | null; dueOn?: string | null; status: TicketStatus }, now = new Date()) {
  const created = new Date(ticket.createdAt)
  const responded = ticket.firstResponseAt ? new Date(ticket.firstResponseAt) : null
  const resolved = ticket.resolvedAt ? new Date(ticket.resolvedAt) : null
  const end = resolved ?? now
  const overdue = ticket.dueOn && ticket.status !== 'resolved' && ticket.status !== 'closed'
    ? Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.UTC(Number(ticket.dueOn.slice(0, 4)), Number(ticket.dueOn.slice(5, 7)) - 1, Number(ticket.dueOn.slice(8, 10)))) / 864e5)
    : 0
  return {
    ageHours: Math.max(0, Math.round(((end.getTime() - created.getTime()) / HOURS) * 10) / 10),
    responseHours: responded ? Math.max(0, Math.round(((responded.getTime() - created.getTime()) / HOURS) * 10) / 10) : null,
    awaitingFirstResponse: !responded && ticket.status !== 'closed' && ticket.status !== 'resolved',
    daysOverdue: overdue > 0 ? overdue : 0,
  }
}

/** Sorting for the queue: urgent first, then overdue, then oldest. */
export const PRIORITY_WEIGHT: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

export function queueOrder<T extends { priority: string; daysOverdue: number; createdAt: Date | string }>(a: T, b: T): number {
  return (PRIORITY_WEIGHT[a.priority] ?? 9) - (PRIORITY_WEIGHT[b.priority] ?? 9)
    || b.daysOverdue - a.daysOverdue
    || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
}

/** Billable support: minutes → hours rounded up to the nearest quarter hour. */
export function billableHours(minutes: number, roundToMinutes = 15): number {
  if (minutes <= 0) return 0
  return Math.ceil(minutes / roundToMinutes) * (roundToMinutes / 60)
}
