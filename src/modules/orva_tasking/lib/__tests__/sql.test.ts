import { describe, expect, it } from '@jest/globals'
import { toUuidArray } from '../sql'

const A = '5d6b3fac-5cb5-4203-99de-43921914f0ab'
const B = '11111111-2222-3333-4444-555555555555'

describe('toUuidArray', () => {
  it('wraps a single id in braces — the case that returned 500 from the board', () => {
    // Bound as a JS array this reached Postgres as a bare uuid and produced
    // `malformed array literal`.
    expect(toUuidArray([A])).toBe(`{${A}}`)
  })

  it('joins several ids with commas', () => {
    expect(toUuidArray([A, B])).toBe(`{${A},${B}}`)
  })

  it('produces an empty array literal for an empty list', () => {
    expect(toUuidArray([])).toBe('{}')
  })

  it('accepts upper case', () => {
    expect(toUuidArray([A.toUpperCase()])).toBe(`{${A.toUpperCase()}}`)
  })

  it('refuses anything that is not a uuid', () => {
    expect(() => toUuidArray(['nope'])).toThrow(/Not a uuid/)
    expect(() => toUuidArray([`${A}'`])).toThrow(/Not a uuid/)
    expect(() => toUuidArray([`${A},${B}`])).toThrow(/Not a uuid/)
    expect(() => toUuidArray(['{}'])).toThrow(/Not a uuid/)
  })

  it('refuses a bad id among good ones', () => {
    expect(() => toUuidArray([A, 'x', B])).toThrow(/Not a uuid/)
  })
})
