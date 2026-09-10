import { describe, expect, it } from '@jest/globals'
import { projectEconomics } from '../projects'

describe('projectEconomics — hours into money', () => {
  it('uses the company default when the project has no rate of its own', () => {
    const e = projectEconomics({ minutes: 90, projectRate: null, defaultRate: 800, billed: 30000, quoteTotal: 100000 })
    expect(e).toEqual({ minutes: 90, hourlyRate: 800, rateSource: 'default', cost: 1200, marginBilled: 28800, marginProjected: 98800 })
  })

  it('lets the project rate win over the default', () => {
    const e = projectEconomics({ minutes: 60, projectRate: 1500, defaultRate: 800, billed: 0, quoteTotal: 50000 })
    expect(e.rateSource).toBe('project')
    expect(e.cost).toBe(1500)
    expect(e.marginBilled).toBe(-1500)
    expect(e.marginProjected).toBe(48500)
  })

  it('reports null, never a zero margin, when nobody has set a rate', () => {
    const e = projectEconomics({ minutes: 600, projectRate: null, defaultRate: null, billed: 10000, quoteTotal: 10000 })
    expect(e).toEqual({ minutes: 600, hourlyRate: null, rateSource: 'none', cost: null, marginBilled: null, marginProjected: null })
  })

  it('rounds to satang and never lets negative minutes through', () => {
    const e = projectEconomics({ minutes: -5, projectRate: null, defaultRate: 333.33, billed: 0, quoteTotal: 0 })
    expect(e.minutes).toBe(0)
    expect(e.cost).toBe(0)
    const f = projectEconomics({ minutes: 7, projectRate: 333.33, defaultRate: null, billed: 0, quoteTotal: 0 })
    expect(f.cost).toBe(38.89)
  })
})
