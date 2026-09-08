import { Check, ChevronDown, Globe } from 'lucide-react'
import { locales } from '@open-mercato/shared/lib/i18n/config'
import { BRAND } from './brand'
import type { MarketingLocale } from './i18n'

/**
 * The language menu for the marketing pages.
 *
 * It offers the SAME six locales as the profile menu inside the app, with the
 * same labels and through the same `/api/auth/locale` route, because a visitor
 * who picks a language before signing in and finds a different, shorter list
 * afterwards has met two products. It used to be an EN/ไทย toggle while the
 * backoffice offered six (owner report, 2026-09-08, with screenshots).
 *
 * Marketing copy exists in Thai and English only; the other four fall back to
 * English per key, exactly as `t()` does anywhere in the app whose module
 * lacks that catalog. The choice still carries into the backoffice, which IS
 * translated into all six — that is the point of sharing the cookie.
 *
 * No client JavaScript: a native `<details>` disclosure holding six links.
 * These pages render before login and must stay light, and links mean the
 * cookie is set by the route rather than by script. Brand colours arrive as
 * inline styles from `./brand`, the marketing surface's palette, rather than
 * as arbitrary Tailwind values.
 */
const LOCALE_LABELS: Record<string, string> = {
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  pl: 'Polski',
  ko: '한국어',
  th: 'ไทย',
}

/** Short label for the closed state — the header is narrow on a phone. */
const LOCALE_SHORT: Record<string, string> = {
  en: 'EN',
  de: 'DE',
  es: 'ES',
  pl: 'PL',
  ko: 'KO',
  th: 'ไทย',
}

export function LanguageSwitcher({
  locale,
  redirectTo,
  label,
}: {
  locale: MarketingLocale
  /** Path to come back to once the cookie is set, e.g. "/start". */
  redirectTo: string
  /** Accessible name for the control, from the shared dictionary. */
  label: string
}) {
  return (
    <details className="relative">
      <summary
        aria-label={label}
        style={{ color: BRAND.onDark }}
        className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-white/20 px-3 py-2 text-sm font-medium transition hover:bg-white/10 hover:text-white [&::-webkit-details-marker]:hidden"
      >
        <Globe className="size-4" />
        {LOCALE_SHORT[locale] ?? locale.toUpperCase()}
        <ChevronDown className="size-3.5 opacity-70" />
      </summary>
      <div className="absolute right-0 z-40 mt-2 min-w-44 overflow-hidden rounded-lg border border-black/10 bg-white py-1 shadow-xl">
        {locales.map((value) => {
          const isCurrent = value === locale
          return (
            <a
              key={value}
              href={`/api/auth/locale?locale=${value}&redirect=${encodeURIComponent(redirectTo)}`}
              aria-current={isCurrent ? 'true' : undefined}
              style={{ color: BRAND.ink }}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm transition hover:bg-black/5"
            >
              <span>{LOCALE_LABELS[value] ?? value}</span>
              {isCurrent ? <Check className="size-4" style={{ color: BRAND.base }} /> : null}
            </a>
          )
        })}
      </div>
    </details>
  )
}
