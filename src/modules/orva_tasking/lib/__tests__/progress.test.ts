import { describe, expect, it } from '@jest/globals'
import { DRIFT_THRESHOLD, donePct, workVsBilling } from '../progress'

describe('donePct', () => {
  it('rounds to one decimal', () => {
    expect(donePct({ total: 3, done: 2 })).toBe(66.7)
  })

  it('is 0 and 100 at the ends', () => {
    expect(donePct({ total: 4, done: 0 })).toBe(0)
    expect(donePct({ total: 4, done: 4 })).toBe(100)
  })

  it('does not divide by zero', () => {
    expect(donePct({ total: 0, done: 0 })).toBe(0)
  })
})

describe('workVsBilling', () => {
  it('says nothing when a project has no tasks', () => {
    // "0% done" against 30% billed would read as alarming, when the truth is
    // simply that nobody has written the tasks down yet.
    expect(workVsBilling({ total: 0, done: 0 }, 30)).toEqual({ verdict: 'no_tasks' })
  })

  it('flags work running ahead of billing — the next งวด is due', () => {
    expect(workVsBilling({ total: 10, done: 8 }, 30)).toEqual({ verdict: 'bill_behind', gap: 50 })
  })

  it('flags money running ahead of the work', () => {
    expect(workVsBilling({ total: 10, done: 1 }, 90)).toEqual({ verdict: 'work_behind', gap: 80 })
  })

  it('stays quiet while the two track each other', () => {
    expect(workVsBilling({ total: 10, done: 4 }, 30)).toEqual({ verdict: 'in_step', gap: 10 })
    expect(workVsBilling({ total: 10, done: 3 }, 30)).toEqual({ verdict: 'in_step', gap: 0 })
  })

  it('treats the threshold itself as worth mentioning', () => {
    expect(workVsBilling({ total: 10, done: 5 }, 50 - DRIFT_THRESHOLD).verdict).toBe('bill_behind')
    // one point under stays quiet — งวด are lumpy, so small drift is noise
    expect(workVsBilling({ total: 100, done: 50 }, 50 - DRIFT_THRESHOLD + 1).verdict).toBe('in_step')
  })

  it('reports the gap as a positive number in both directions', () => {
    const behind = workVsBilling({ total: 10, done: 1 }, 90)
    expect(behind).toMatchObject({ verdict: 'work_behind' })
    if (behind.verdict === 'work_behind') expect(behind.gap).toBeGreaterThan(0)
  })
})
