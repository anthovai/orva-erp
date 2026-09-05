import { describe, expect, it } from '@jest/globals'
import { findSubtaskCycle, inverseKind } from '../relations'

describe('inverseKind', () => {
  it('pairs subtask with parent and blocks with blocked_by', () => {
    expect(inverseKind('subtask')).toBe('parent')
    expect(inverseKind('parent')).toBe('subtask')
    expect(inverseKind('blocks')).toBe('blocked_by')
    expect(inverseKind('blocked_by')).toBe('blocks')
  })

  it('makes related its own inverse', () => {
    expect(inverseKind('related')).toBe('related')
  })

  it('round-trips every kind', () => {
    for (const kind of ['subtask', 'parent', 'blocks', 'blocked_by', 'related'] as const) {
      expect(inverseKind(inverseKind(kind))).toBe(kind)
    }
  })
})

describe('findSubtaskCycle', () => {
  it('allows a first parent link', () => {
    expect(findSubtaskCycle([], 'a', 'b')).toBeNull()
  })

  it('allows a second child under the same parent', () => {
    expect(findSubtaskCycle([{ from: 'a', to: 'b' }], 'a', 'c')).toBeNull()
  })

  it('refuses a task as its own subtask', () => {
    expect(findSubtaskCycle([], 'a', 'a')).toEqual(['a', 'a'])
  })

  it('refuses the direct loop back', () => {
    // a → b already exists; making b the parent of a closes it
    expect(findSubtaskCycle([{ from: 'a', to: 'b' }], 'b', 'a')).toEqual(['b', 'a', 'b'])
  })

  it('refuses a loop through a chain, and names the path', () => {
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ]
    expect(findSubtaskCycle(edges, 'c', 'a')).toEqual(['c', 'a', 'b', 'c'])
  })

  it('allows a diamond, which is not a cycle', () => {
    // b and c both under a; d under both. Nothing is its own ancestor.
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
      { from: 'b', to: 'd' },
    ]
    expect(findSubtaskCycle(edges, 'c', 'd')).toBeNull()
  })

  it('terminates on a graph that already contains a loop', () => {
    // Should never happen, but a guard that hangs is worse than one that says no.
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
    ]
    expect(findSubtaskCycle(edges, 'a', 'b')).toEqual(['a', 'b', 'a'])
  })
})
