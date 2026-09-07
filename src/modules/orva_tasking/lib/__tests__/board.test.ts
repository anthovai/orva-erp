import { describe, expect, it } from '@jest/globals'
import { placeCard, wipState } from '../board'

describe('placeCard', () => {
  it('drops a card into an empty column', () => {
    expect(placeCard([], 'x', 0)).toEqual(['x'])
  })

  it('drops at the top, the middle and the bottom', () => {
    expect(placeCard(['a', 'b', 'c'], 'x', 0)).toEqual(['x', 'a', 'b', 'c'])
    expect(placeCard(['a', 'b', 'c'], 'x', 2)).toEqual(['a', 'b', 'x', 'c'])
    expect(placeCard(['a', 'b', 'c'], 'x', 3)).toEqual(['a', 'b', 'c', 'x'])
  })

  it('reorders within the same column instead of duplicating the card', () => {
    expect(placeCard(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a'])
    expect(placeCard(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b'])
  })

  it('is a no-op when a card is dropped back where it already was', () => {
    expect(placeCard(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'b', 'c'])
  })

  it('clamps an index past the end, so a stale client cannot leave a gap', () => {
    expect(placeCard(['a', 'b'], 'x', 99)).toEqual(['a', 'b', 'x'])
  })

  it('clamps a negative index', () => {
    expect(placeCard(['a', 'b'], 'x', -5)).toEqual(['x', 'a', 'b'])
  })

  it('never loses or repeats a card', () => {
    const column = ['a', 'b', 'c', 'd']
    for (let i = 0; i <= column.length; i += 1) {
      const next = placeCard(column, 'c', i)
      expect(next.length).toBe(column.length)
      expect(new Set(next).size).toBe(column.length)
    }
  })
})

describe('wipState', () => {
  it('treats 0 as no limit, however full the column is', () => {
    expect(wipState(50, 0)).toEqual({ over: false, count: 50, limit: 0 })
  })

  it('is not over at exactly the limit', () => {
    expect(wipState(3, 3).over).toBe(false)
  })

  it('is over one past the limit', () => {
    expect(wipState(4, 3).over).toBe(true)
  })
})
