/**
 * Public lead capture: turning an anonymous enquiry into a deal on the
 * pipeline with the channel it came from already filled in.
 *
 * The rules here are the ones an open form needs and a backend form does
 * not: what counts as the same person coming back, how a free-text channel
 * maps onto the `lead_source` options the pipeline filters by, and what the
 * deal is called before anyone has spoken to them. IO-free so each is tested
 * without a database or a browser.
 */

/** The `lead_source` options defined in `orva/ce.ts` — keep the two in step. */
export const LEAD_SOURCES = [
  'เพื่อนแนะนำ/ปากต่อปาก',
  'ลูกค้าเก่า',
  'Facebook',
  'LINE',
  'เว็บไซต์',
  'อีเวนต์/ออกบูธ',
  'อื่นๆ',
] as const
export type LeadSource = (typeof LEAD_SOURCES)[number]

/** A lead arriving through the public form is a website lead unless it says otherwise. */
export const DEFAULT_LEAD_SOURCE: LeadSource = 'เว็บไซต์'

/**
 * Anything the form did not offer becomes 'อื่นๆ' rather than being written
 * through: a value outside the select would be invisible to the pipeline
 * filter, which is the only reason the field exists.
 */
export function normaliseSource(value: string | null | undefined): LeadSource {
  if (!value) return DEFAULT_LEAD_SOURCE
  const trimmed = value.trim()
  const match = LEAD_SOURCES.find((option) => option === trimmed)
  return match ?? 'อื่นๆ'
}

/** Casing and surrounding space must not create a second person. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * The deal's title before anyone has spoken to the enquirer: the company if
 * they gave one, else their name, so the pipeline reads as businesses rather
 * than a column of "New enquiry".
 */
export function leadTitle(input: { name: string; company?: string | null }): string {
  const company = input.company?.trim()
  return (company && company.length > 0 ? company : input.name.trim()).slice(0, 200)
}

/**
 * Contact details belong in the deal body, because a public form cannot be
 * trusted to have produced a person worth adding to the CRM until someone
 * reads it.
 */
export function leadDescription(input: {
  name: string
  email: string
  company?: string | null
  phone?: string | null
  message?: string | null
  source: LeadSource
}): string {
  const lines = [
    `ชื่อ: ${input.name.trim()}`,
    `อีเมล: ${normaliseEmail(input.email)}`,
    input.company?.trim() ? `บริษัท: ${input.company.trim()}` : null,
    input.phone?.trim() ? `โทร: ${input.phone.trim()}` : null,
    `ช่องทางที่มา: ${input.source}`,
  ].filter(Boolean)
  const message = input.message?.trim()
  if (message) lines.push('', message)
  return lines.join('\n').slice(0, 4000)
}

/** Milliseconds within which the same email is treated as one enquiry. */
export const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Whether this submission should append to the existing deal instead of
 * opening a second one. Someone who fills the form twice in an afternoon —
 * or double-taps submit — is one lead, not two.
 */
export function isDuplicateWithin(
  lastSeenAt: Date | string | null | undefined,
  now: Date,
  windowMs = DEDUPE_WINDOW_MS,
): boolean {
  if (!lastSeenAt) return false
  const last = lastSeenAt instanceof Date ? lastSeenAt : new Date(lastSeenAt)
  if (Number.isNaN(last.getTime())) return false
  const elapsed = now.getTime() - last.getTime()
  return elapsed >= 0 && elapsed < windowMs
}

/**
 * A bot filled the field humans never see, so the submission is discarded.
 * The caller still answers 200 — telling a bot it was detected only teaches
 * it to try again without the trap.
 */
export function looksLikeBot(honeypot: string | null | undefined): boolean {
  return typeof honeypot === 'string' && honeypot.trim().length > 0
}
