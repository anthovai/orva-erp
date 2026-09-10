import { randomBytes } from 'node:crypto'

/** 192 random bits, URL-safe; unguessable and short enough for an email footer. */
export function newToken(): string {
  return randomBytes(24).toString('base64url')
}

/** The public page that withdraws consent — scoped by the slug, identified by the token. */
export function unsubscribeUrl(origin: string, orgSlug: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/${encodeURIComponent(orgSlug)}/portal/unsubscribe/${encodeURIComponent(token)}`
}

/**
 * Thai PDPA and every mail provider's bulk-sender rules want a working opt-out
 * in the message itself, so the footer is appended per recipient at send
 * time; the stored body stays clean for the next edit.
 */
export function withUnsubscribeFooter(body: string, url: string): string {
  return `${body.trimEnd()}\n\n---\nหากไม่ต้องการรับข่าวสารจากเรา กดที่นี่: ${url}`
}
