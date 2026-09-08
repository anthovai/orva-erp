import { describe, expect, it } from '@jest/globals'
import en from '@/i18n/en.json'
import th from '@/i18n/th.json'
import { buildMarketingDict } from '../i18n'

const marketingKeys = (dict: Record<string, unknown>) =>
  Object.keys(dict).filter((key) => key.startsWith('marketing.')).sort()

describe('marketing translations share the app dictionary', () => {
  it('has the same marketing.* keys in th and en, so neither page silently falls back', () => {
    expect(marketingKeys(th as Record<string, unknown>)).toEqual(marketingKeys(en as Record<string, unknown>))
  })

  it('builds from a merged app dictionary, not a hand-picked file', () => {
    const dict = buildMarketingDict(th as Record<string, string>)
    expect(dict.nav.login).toBe((th as Record<string, string>)['marketing.nav.login'])
    expect(dict.nav.switchLocale).toBe('เลือกภาษา')
  })

  it('falls back to English per key for a locale with no marketing copy', () => {
    const dict = buildMarketingDict({})
    expect(dict.hero.title).toBe((en as Record<string, string>)['marketing.hero.title'])
    // de / es / pl / ko carry no marketing.* keys at all, so this is the path
    // those four take: English copy, their own backoffice language.
    expect(dict.nav.switchLocale).toBe((en as Record<string, string>)['marketing.nav.switchLocale'])
  })
})
