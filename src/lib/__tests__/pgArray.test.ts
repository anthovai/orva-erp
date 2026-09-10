import { describe, expect, it } from '@jest/globals'
import { toPgTextArray } from '../pgArray'

describe('toPgTextArray binds a list as one Postgres array literal', () => {
  it('quotes every element', () => {
    expect(toPgTextArray(['mrv-bl200', 'kkg-01'])).toBe('{"mrv-bl200","kkg-01"}')
  })

  it('escapes the characters that would end the element or the literal', () => {
    expect(toPgTextArray(['a,b', 'say "hi"', 'back\\slash', '{brace}'])).toBe('{"a,b","say \\"hi\\"","back\\\\slash","{brace}"}')
  })

  it('an empty list is an empty array, not an error', () => {
    expect(toPgTextArray([])).toBe('{}')
  })
})
