import { describe, expect, it } from '@jest/globals'
import { projectRateSchema, settingsPutSchema } from '../../data/validators'

/**
 * Guards a trap that cost an integration run: `z.coerce.number()` turns null
 * into 0, so in a union the null branch has to come first. A rate stored as 0
 * instead of null says the work costs nothing per hour, and the project list
 * would then report the whole quote as margin.
 */
describe('an hourly rate can be cleared, not silently zeroed', () => {
  const base = { sellerName: 'Kaiser' }

  it('keeps null as null', () => {
    expect(settingsPutSchema.parse({ ...base, defaultHourlyRate: null }).defaultHourlyRate).toBeNull()
  })

  it('treats an empty form field as cleared', () => {
    expect(settingsPutSchema.parse({ ...base, defaultHourlyRate: '' }).defaultHourlyRate).toBeNull()
  })

  it('still accepts a number, typed or as a string from the form', () => {
    expect(settingsPutSchema.parse({ ...base, defaultHourlyRate: 800 }).defaultHourlyRate).toBe(800)
    expect(settingsPutSchema.parse({ ...base, defaultHourlyRate: '1250.5' }).defaultHourlyRate).toBe(1250.5)
  })

  it('leaves the field untouched when it is not sent', () => {
    expect(settingsPutSchema.parse(base).defaultHourlyRate).toBeUndefined()
  })

  it('clears a project override with null and refuses a negative rate', () => {
    const quoteId = '11111111-2222-4333-8444-555555555555'
    expect(projectRateSchema.parse({ quoteId, hourlyRate: null }).hourlyRate).toBeNull()
    expect(projectRateSchema.parse({ quoteId, hourlyRate: '900' }).hourlyRate).toBe(900)
    expect(() => projectRateSchema.parse({ quoteId, hourlyRate: -1 })).toThrow()
  })
})
