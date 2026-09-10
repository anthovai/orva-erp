import { describe, expect, it } from '@jest/globals'
import { subscriptionCreateSchema } from '../../data/validators'

/**
 * Same trap as the documents settings: `z.coerce.number()` reads null as 0,
 * so the null branch of the union comes first. A retainer amount stored as 0
 * would bill the customer nothing and hide the real fee behind a fallback
 * that never fires.
 */
describe('a retainer amount can be absent without becoming zero', () => {
  const base = { name: 'ค่าดูแลระบบรายเดือน' }

  it('keeps null as null and an empty field as cleared', () => {
    expect(subscriptionCreateSchema.parse({ ...base, retainerAmount: null }).retainerAmount).toBeNull()
    expect(subscriptionCreateSchema.parse({ ...base, retainerAmount: '' }).retainerAmount).toBeNull()
  })

  it('accepts a number, and defaults the toggle to off', () => {
    const parsed = subscriptionCreateSchema.parse({ ...base, retainerAmount: '5000' })
    expect(parsed.retainerAmount).toBe(5000)
    expect(parsed.invoiceOnRenewal).toBeUndefined()
  })
})
