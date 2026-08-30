// Marketing-page translations — SINGLE SOURCE with the system dictionaries.
//
// Every string lives as a flat `marketing.*` key in src/i18n/<locale>.json
// (the app-level dictionary the framework's loader already serves), so the
// same keys are also available to `t()` inside the app. The marketing pages
// import those JSON files directly instead of bootstrapping the module
// registry: /start and /about render before login and must stay light.
//
// The locale comes from the same `locale` cookie the app uses, so a choice
// made on the landing page carries into the backoffice.
import en from '@/i18n/en.json'
import th from '@/i18n/th.json'

export type MarketingLocale = 'th' | 'en'

export function resolveMarketingLocale(cookieValue: string | undefined): MarketingLocale {
  return cookieValue === 'en' ? 'en' : 'th'
}

const SOURCES: Record<MarketingLocale, Record<string, string>> = {
  en: en as Record<string, string>,
  th: th as Record<string, string>,
}

type TitleBody = { title: string; body: string }
type ValueLabel = { value: string; label: string }

function build(locale: MarketingLocale) {
  const dict = SOURCES[locale]
  const fallback = SOURCES.en
  const g = (key: string): string => dict[`marketing.${key}`] ?? fallback[`marketing.${key}`] ?? key
  const titleBody = (key: string): TitleBody => ({ title: g(`${key}.title`), body: g(`${key}.body`) })
  const list = (key: string, count: number): string[] =>
    Array.from({ length: count }, (_, index) => g(`${key}.${index}`))

  return {
    nav: {
      modules: g('nav.modules'),
      screens: g('nav.screens'),
      architecture: g('nav.architecture'),
      about: g('nav.about'),
      admin: g('nav.admin'),
      login: g('nav.login'),
    },
    hero: {
      badge: g('hero.badge'),
      title: g('hero.title'),
      subtitle: g('hero.subtitle'),
      body: g('hero.body'),
      ctaStart: g('hero.ctaStart'),
      ctaScreens: g('hero.ctaScreens'),
      trust: list('hero.trust', 4),
      financeAlt: g('hero.financeAlt'),
      payrollAlt: g('hero.payrollAlt'),
    },
    stats: Array.from({ length: 4 }, (_, index): ValueLabel => ({
      value: g(`stats.${index}.value`),
      label: g(`stats.${index}.label`),
    })),
    modules: {
      kicker: g('modules.kicker'),
      title: g('modules.title'),
      subtitle: g('modules.subtitle'),
      financeTitle: g('modules.financeTitle'),
      financeBadge: g('modules.financeBadge'),
      financeItems: Array.from({ length: 4 }, (_, index) => titleBody(`modules.financeItems.${index}`)),
      suites: Array.from({ length: 3 }, (_, index) => ({
        title: g(`modules.suites.${index}.title`),
        items: list(`modules.suites.${index}.items`, 4),
      })),
    },
    screens: {
      kicker: g('screens.kicker'),
      title: g('screens.title'),
      cap1Title: g('screens.cap1Title'),
      cap1Body: g('screens.cap1Body'),
      cap2Title: g('screens.cap2Title'),
      cap2Body: g('screens.cap2Body'),
    },
    architecture: {
      kicker: g('architecture.kicker'),
      title: g('architecture.title'),
      points: Array.from({ length: 3 }, (_, index) => titleBody(`architecture.points.${index}`)),
      techLine: g('architecture.techLine'),
    },
    cta: {
      title: g('cta.title'),
      body: g('cta.body'),
      button: g('cta.button'),
    },
    footer: {
      tagline: g('footer.tagline'),
      product: g('footer.product'),
      getStarted: g('footer.getStarted'),
      company: g('footer.company'),
      allModules: g('footer.allModules'),
      screens: g('footer.screens'),
      architecture: g('footer.architecture'),
      about: g('footer.about'),
      login: g('footer.login'),
      admin: g('footer.admin'),
      api: g('footer.api'),
      copyright: g('footer.copyright'),
    },
    about: {
      kicker: g('about.kicker'),
      title: g('about.title'),
      lead: g('about.lead'),
      missionTitle: g('about.missionTitle'),
      missionBody: g('about.missionBody'),
      whatTitle: g('about.whatTitle'),
      whatItems: Array.from({ length: 4 }, (_, index) => titleBody(`about.whatItems.${index}`)),
      principlesTitle: g('about.principlesTitle'),
      principles: Array.from({ length: 3 }, (_, index) => titleBody(`about.principles.${index}`)),
      companyTitle: g('about.companyTitle'),
      companyBody: g('about.companyBody'),
      techTitle: g('about.techTitle'),
      techBody: g('about.techBody'),
      ctaTitle: g('about.ctaTitle'),
      ctaBody: g('about.ctaBody'),
      ctaScreens: g('about.ctaScreens'),
      ctaLogin: g('about.ctaLogin'),
    },
  }
}

export type MarketingDict = ReturnType<typeof build>

export const marketingDict: Record<MarketingLocale, MarketingDict> = {
  th: build('th'),
  en: build('en'),
}
