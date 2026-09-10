import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { toPgTextArray } from '@/lib/pgArray'

/** The custom fields orva/ce.ts defines on the shared customer record. */
export const CUSTOMER_ENTITY_ID = 'customers:customer_entity'
export const CONSENT_KEY = 'marketing_consent'
export const CONSENT_AT_KEY = 'marketing_consent_at'
export const CONSENT_SOURCE_KEY = 'marketing_consent_source'

export type Scope = { tenantId: string; organizationId: string }

export type Contact = {
  id: string
  kind: 'person' | 'company'
  displayName: string
  email: string | null
  consent: boolean
  consentAt: string | null
  consentSource: string | null
}

export type AudienceCounts = {
  total: number
  consented: number
  reachable: number
  noEmail: number
  notConsented: number
}

export type Recipient = { id: string; displayName: string; email: string }

/** Lower-cased, trimmed; the address is compared and deduplicated on this. */
export function normaliseEmail(value: string | null | undefined): string | null {
  const email = (value ?? '').trim().toLowerCase()
  return email && email.includes('@') ? email : null
}

/**
 * Who a broadcast goes to: consented contacts with an address, one email per
 * address even when two contacts share it (a couple, a company and its
 * owner). Pure — the integration test and the send route agree by construction.
 */
export function pickRecipients(contacts: Contact[]): { recipients: Recipient[]; counts: AudienceCounts } {
  const seen = new Set<string>()
  const recipients: Recipient[] = []
  let consented = 0
  let noEmail = 0
  for (const contact of contacts) {
    if (!contact.consent) continue
    consented += 1
    const email = normaliseEmail(contact.email)
    if (!email) { noEmail += 1; continue }
    if (seen.has(email)) continue
    seen.add(email)
    recipients.push({ id: contact.id, displayName: contact.displayName, email })
  }
  return {
    recipients,
    counts: { total: contacts.length, consented, reachable: recipients.length, noEmail, notConsented: contacts.length - consented },
  }
}

/** Case-insensitive match on the name or the address; empty search keeps all. */
export function filterContacts(contacts: Contact[], search: string | undefined): Contact[] {
  const needle = (search ?? '').trim().toLowerCase()
  if (!needle) return contacts
  return contacts.filter((c) => c.displayName.toLowerCase().includes(needle) || (c.email ?? '').toLowerCase().includes(needle))
}

type ConsentRow = { record_id: string; field_key: string; value_bool: boolean | null; value_text: string | null }

/**
 * Every active contact of the organisation with its consent. Names and
 * addresses are encrypted at rest, so they come through `findWithDecryption`
 * and the search runs in memory — a one-person company has hundreds of
 * contacts, not millions. Consent is read straight from custom_field_values,
 * the seam the tax-id and reorder-point reads already use.
 */
export async function loadContacts(tem: EntityManager, scope: Scope, limit = 2000): Promise<Contact[]> {
  const entities = await findWithDecryption(
    tem, CustomerEntity,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null, isActive: true },
    { orderBy: { createdAt: 'asc' }, limit },
    { tenantId: scope.tenantId },
  )
  if (!entities.length) return []
  const ids = entities.map((e) => String(e.id))
  const rows = (await tem.execute(
    `select record_id, field_key, value_bool, value_text
     from custom_field_values
     where entity_id = ? and organization_id = ?::uuid and deleted_at is null
       and field_key in (?, ?, ?) and record_id = any(?::text[])`,
    [CUSTOMER_ENTITY_ID, scope.organizationId, CONSENT_KEY, CONSENT_AT_KEY, CONSENT_SOURCE_KEY, toPgTextArray(ids)],
  )) as ConsentRow[]
  const byRecord = new Map<string, { consent: boolean; at: string | null; source: string | null }>()
  for (const row of rows) {
    const entry = byRecord.get(row.record_id) ?? { consent: false, at: null, source: null }
    if (row.field_key === CONSENT_KEY) entry.consent = row.value_bool === true
    else if (row.field_key === CONSENT_AT_KEY) entry.at = row.value_text ? String(row.value_text).slice(0, 10) : null
    else if (row.field_key === CONSENT_SOURCE_KEY) entry.source = row.value_text ? String(row.value_text) : null
    byRecord.set(row.record_id, entry)
  }
  return entities.map((entity) => {
    const consent = byRecord.get(String(entity.id))
    return {
      id: String(entity.id),
      kind: entity.kind === 'company' ? 'company' : 'person',
      displayName: String(entity.displayName ?? ''),
      email: normaliseEmail(entity.primaryEmail ?? null),
      consent: consent?.consent ?? false,
      consentAt: consent?.at ?? null,
      consentSource: consent?.source ?? null,
    }
  })
}
