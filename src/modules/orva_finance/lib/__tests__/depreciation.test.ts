import { describe, expect, test } from '@jest/globals'
import { inServiceFor, monthlyDepreciation } from '../depreciation'

describe('straight-line depreciation', () => {
  test('even split, salvage respected', () => {
    // 36,000 laptop, 1,000 salvage, 60 months → 583.33/month
    expect(monthlyDepreciation({ cost: 36000, salvage: 1000, usefulLifeMonths: 60, monthsDone: 0, accumulated: 0 })).toBe(583.33)
  })

  test('final month absorbs the rounding remainder and never overshoots', () => {
    // 583.33 × 59 = 34,416.47 → last month 583.53 to land on exactly 35,000
    const last = monthlyDepreciation({ cost: 36000, salvage: 1000, usefulLifeMonths: 60, monthsDone: 59, accumulated: 34416.47 })
    expect(last).toBe(583.53)
    expect(monthlyDepreciation({ cost: 36000, salvage: 1000, usefulLifeMonths: 60, monthsDone: 60, accumulated: 35000 })).toBe(0)
  })

  test('nothing to depreciate when fully written down or invalid', () => {
    expect(monthlyDepreciation({ cost: 1000, salvage: 1000, usefulLifeMonths: 12, monthsDone: 0, accumulated: 0 })).toBe(0)
    expect(monthlyDepreciation({ cost: 1000, salvage: 0, usefulLifeMonths: 0, monthsDone: 0, accumulated: 0 })).toBe(0)
  })

  test('in-service test by month', () => {
    expect(inServiceFor('2026-08-15', '2026-08-01', '2026-08-31')).toBe(true)
    expect(inServiceFor('2026-09-02', '2026-08-01', '2026-08-31')).toBe(false)
    expect(inServiceFor('2026-01-31', '2026-08-01', '2026-08-31')).toBe(true)
  })
})
