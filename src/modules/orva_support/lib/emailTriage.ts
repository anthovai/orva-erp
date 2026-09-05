/**
 * Turning an inbound email into a ticket that is already attached to the right
 * customer and the right project.
 *
 * The judgement here is deliberately conservative: a wrong attachment is worse
 * than none, because a ticket filed against the wrong client is read as fact
 * by everyone downstream, whereas an unattached one merely asks the owner a
 * question. Every rule below refuses to guess when the evidence is ambiguous.
 *
 * IO-free so the rules are tested without a mailbox.
 */

export type Contact = {
  customerEntityId: string
  customerName: string | null
  email: string
}

export type CustomerMatch = {
  customerEntityId: string
  customerName: string | null
  /** How it was matched — shown on the ticket so the owner can judge it. */
  basis: 'email' | 'domain'
}

/**
 * Domains where sharing an address says nothing about sharing an employer.
 * Without this, two unrelated clients on Gmail would look like one company.
 */
const PUBLIC_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'live.com',
  'yahoo.com', 'yahoo.co.th', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com',
  'aol.com', 'msn.com', 'qq.com', '163.com', 'naver.com', 'hotmail.co.th',
])

export const normaliseEmail = (value: string): string => value.trim().toLowerCase()

export function domainOf(email: string): string | null {
  const at = normaliseEmail(email).lastIndexOf('@')
  if (at < 1) return null
  const domain = normaliseEmail(email).slice(at + 1)
  return domain.length > 0 ? domain : null
}

/**
 * Exact address wins. Failing that, a company domain may identify the customer
 * — but only when every contact on that domain belongs to the same customer,
 * and never on a public mail provider. Two customers sharing a domain (an
 * agency, a group) yields null rather than a coin toss.
 */
export function matchCustomer(sender: string, contacts: readonly Contact[]): CustomerMatch | null {
  const address = normaliseEmail(sender)
  if (!address) return null

  const exact = contacts.find((contact) => normaliseEmail(contact.email) === address)
  if (exact) {
    return { customerEntityId: exact.customerEntityId, customerName: exact.customerName, basis: 'email' }
  }

  const domain = domainOf(address)
  if (!domain || PUBLIC_MAIL_DOMAINS.has(domain)) return null

  const onDomain = contacts.filter((contact) => domainOf(contact.email) === domain)
  if (!onDomain.length) return null
  const distinct = new Set(onDomain.map((contact) => contact.customerEntityId))
  if (distinct.size !== 1) return null
  return { customerEntityId: onDomain[0].customerEntityId, customerName: onDomain[0].customerName, basis: 'domain' }
}

export type ProjectRef = {
  quoteId: string
  quoteNumber: string
  customerEntityId: string | null
}

/**
 * A quote or invoice number quoted in the mail is the strongest signal, and is
 * honoured even when the sender could not be identified. Otherwise a customer
 * with exactly one open project is unambiguous; more than one is not, and
 * guessing would file the ticket against the wrong job.
 *
 * A number belonging to a different customer than the sender is ignored: that
 * combination means the match is wrong somewhere, and picking either half
 * would propagate the error.
 */
export function inferProject(
  text: string,
  projects: readonly ProjectRef[],
  customerEntityId: string | null,
): string | null {
  const haystack = (text ?? '').toUpperCase()
  const quoted = projects.filter(
    (project) => project.quoteNumber.length >= 4 && haystack.includes(project.quoteNumber.toUpperCase()),
  )
  if (quoted.length === 1) {
    const project = quoted[0]
    if (customerEntityId && project.customerEntityId && project.customerEntityId !== customerEntityId) return null
    return project.quoteId
  }
  if (quoted.length > 1) return null

  if (!customerEntityId) return null
  const theirs = projects.filter((project) => project.customerEntityId === customerEntityId)
  return theirs.length === 1 ? theirs[0].quoteId : null
}

/** Ticket kind guessed from how the customer wrote — the owner can change it. */
export type TicketKind = 'bug' | 'question' | 'change_request' | 'incident'

/**
 * Thai is matched as a plain substring and English on word boundaries. `\b` is
 * defined over [A-Za-z0-9_], so a Thai keyword wrapped in \b can never match —
 * Thai writes without spaces and its characters are not word characters. The
 * two scripts therefore need separate patterns, most severe kind first.
 */
const KIND_HINTS: Array<{ kind: TicketKind; thai: RegExp; latin: RegExp }> = [
  { kind: 'incident', thai: /(ล่ม|ใช้ไม่ได้|ดาวน์|ด่วน|เข้าไม่ได้)/, latin: /\b(down|outage|urgent|critical)\b/i },
  { kind: 'bug', thai: /(บั๊ก|บัค|พัง|ไม่ทำงาน|แจ้งปัญหา|เพี้ยน|ผิดพลาด)/, latin: /\b(bug|error|broken|crash(?:es|ed)?)\b/i },
  { kind: 'change_request', thai: /(ขอเพิ่ม|อยากได้|เพิ่มฟีเจอร์|แก้ดีไซน์|ขอปรับ)/, latin: /\b(feature|request|enhancement)\b/i },
]

/**
 * Defaults to `question`: an email nobody classified is a question until read.
 * Calling everything a bug would inflate the one number the owner watches.
 */
export function guessKind(subject: string, body: string): TicketKind {
  const text = `${subject ?? ''}\n${body ?? ''}`
  for (const hint of KIND_HINTS) {
    if (hint.thai.test(text) || hint.latin.test(text)) return hint.kind
  }
  return 'question'
}
