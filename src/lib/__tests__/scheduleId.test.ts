import { describe, expect, test } from '@jest/globals'
import { stableScheduleId } from '../scheduleId'

/**
 * The scheduler upserts by id and its column is a uuid, so the id a module
 * registers under has to be a real uuid that never changes for the same key.
 */
describe('stableScheduleId', () => {
  const key = 'orva_purchasing.late_scan:05428513-7ddc-407d-bb8d-b2b679b6e9ae'

  test('is a well-formed version-5 uuid', () => {
    expect(stableScheduleId(key)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  test('the same key always yields the same id — that is what makes re-running setup an update', () => {
    expect(stableScheduleId(key)).toBe(stableScheduleId(key))
  })

  test('a different organization, or a different queue, yields a different id', () => {
    expect(stableScheduleId(key)).not.toBe(stableScheduleId('orva_purchasing.late_scan:11111111-2222-3333-4444-555555555555'))
    expect(stableScheduleId(key)).not.toBe(stableScheduleId('orva_finance.daily_brief:05428513-7ddc-407d-bb8d-b2b679b6e9ae'))
  })

  test('is pinned: changing the derivation would orphan every schedule already registered under it', () => {
    // If this fails, the namespace or hashing changed. Do not update the
    // expected value — restore the derivation, or write a migration that
    // re-keys existing scheduled_jobs rows.
    expect(stableScheduleId('pinned-key')).toBe('00a4eb01-94a3-5935-9411-541ac34682cb')
  })
})
