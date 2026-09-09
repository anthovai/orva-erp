import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * Stable ids for the schedules Orva modules register in `seedDefaults`.
 *
 * `schedulerService.register` upserts by `id`, and `scheduled_jobs.id` is a
 * uuid column. Both Orva modules used to pass a readable string such as
 * `orva_purchasing.late_scan:<org>` — which Postgres rejects with "invalid
 * input syntax for type uuid", so the purchasing scan was never registered on
 * the real tenant and the failure surfaced only as a warning in a seed log.
 * Finance's two schedules exist from an earlier registration path and carry
 * random ids, so a naive switch to a derived uuid would register them a second
 * time.
 *
 * Hence two functions: a name-based uuid for a key (RFC 4122 v5 shape, SHA-1
 * over a fixed namespace), and a resolver that first looks for the schedule a
 * module already has for the same queue and organization, so re-running setup
 * updates the row that is there instead of creating a twin next to it.
 */

/** Fixed namespace so the same key always yields the same id, on every install. */
const ORVA_SCHEDULE_NAMESPACE = '6f0c1a4e-3b0d-4c1c-9e0a-7b2d5f8a1c3e'

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/-/g, '')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** A uuid derived from `key` alone. Same key, same uuid, forever. */
export function stableScheduleId(key: string): string {
  const hash = createHash('sha1')
  hash.update(hexToBytes(ORVA_SCHEDULE_NAMESPACE))
  hash.update(key, 'utf8')
  const bytes = hash.digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50 // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC 4122 variant
  const hex = Buffer.from(bytes).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export type ScheduleLookup = {
  /** The readable key the module has always used, e.g. `orva_purchasing.late_scan:<org>`. */
  key: string
  targetQueue: string
  organizationId: string
}

/**
 * The id `register` should be called with: an existing schedule for the same
 * queue and organization if there is one (whatever id it carries), otherwise
 * the stable uuid for the key.
 */
export async function resolveScheduleId(em: EntityManager, lookup: ScheduleLookup): Promise<string> {
  const rows = (await em.execute(
    `select id from scheduled_jobs
     where target_queue = ? and organization_id = ?::uuid and deleted_at is null
     order by created_at asc limit 1`,
    [lookup.targetQueue, lookup.organizationId],
  )) as Array<{ id: string }>
  return rows[0]?.id ?? stableScheduleId(lookup.key)
}
