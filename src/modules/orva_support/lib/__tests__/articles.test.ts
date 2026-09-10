import { describe, expect, it } from '@jest/globals'
import { excerpt, matchesSearch, slugify, uniqueSlug } from '../articles'

describe('a title becomes a link', () => {
  it('keeps Thai and collapses everything else into dashes', () => {
    expect(slugify('วิธีรีเซ็ตรหัสผ่าน')).toBe('วิธีรีเซ็ตรหัสผ่าน')
    expect(slugify('How do I  reset my password?')).toBe('how-do-i-reset-my-password')
    expect(slugify('  --- Retainer: what it covers ---  ')).toBe('retainer-what-it-covers')
  })

  it('never ends on a dash, however the title ends', () => {
    expect(slugify('Bug report — ')).toBe('bug-report')
  })

  it('numbers a slug that is already taken', () => {
    expect(uniqueSlug('help', [])).toBe('help')
    expect(uniqueSlug('help', ['help'])).toBe('help-2')
    expect(uniqueSlug('help', ['help', 'help-2', 'help-3'])).toBe('help-4')
  })

  it('falls back to a name rather than an empty slug', () => {
    expect(uniqueSlug(slugify('???'), [])).toBe('article')
  })
})

describe('search and excerpt', () => {
  const article = { title: 'รีเซ็ตรหัสผ่าน', summary: null, body: '# หัวข้อ\n\nกดลืมรหัสผ่านที่หน้า login', tags: ['บัญชี', 'login'] }

  it('matches the title, the tags or the body, case-insensitively', () => {
    expect(matchesSearch(article, 'LOGIN')).toBe(true)
    expect(matchesSearch(article, 'รหัสผ่าน')).toBe(true)
    expect(matchesSearch(article, 'บัญชี')).toBe(true)
    expect(matchesSearch(article, 'ใบกำกับ')).toBe(false)
    expect(matchesSearch(article, '   ')).toBe(true)
  })

  it('takes the first line of prose, past the markdown heading marks', () => {
    expect(excerpt(article.body)).toBe('หัวข้อ')
    expect(excerpt('\n\n- ข้อแรก\nข้อสอง')).toBe('ข้อแรก')
    expect(excerpt('x'.repeat(200), 20)).toBe(`${'x'.repeat(19)}…`)
  })
})
