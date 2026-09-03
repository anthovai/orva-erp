import { describe, expect, test } from '@jest/globals'
import { money, toCsv } from '../csv'

describe('accountant CSV', () => {
  test('starts with a BOM, uses CRLF, quotes commas/quotes/newlines, formats numbers to 2 places', () => {
    const csv = toCsv(['a', 'b', 'c'], [['x,y', 'say "hi"', 1234.5], [null, 'line\nbreak', 0]])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.slice(1)).toBe('a,b,c\r\n"x,y","say ""hi""",1234.50\r\n,"line\nbreak",0.00\r\n')
  })

  test('money rounds to satang and never yields NaN', () => {
    expect(money('24960.0000')).toBe(24960)
    expect(money('0.005')).toBe(0.01)
    expect(money(null)).toBe(0)
    expect(money('abc')).toBe(0)
  })
})
