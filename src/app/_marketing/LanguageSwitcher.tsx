import { Globe } from 'lucide-react'
import type { MarketingLocale } from './i18n'

/**
 * Locale toggle for the marketing pages. It goes through the app's own
 * `GET /api/auth/locale` route — the same one the backoffice profile menu
 * uses — so the cookie it writes is the one `detectLocale()` reads, and a
 * choice made on the landing page is the language the system signs in with.
 * Rendered only when the locale is not pinned by OM_FORCE_LOCALE (that route
 * answers 409 when it is).
 */
export function LanguageSwitcher({
  locale,
  redirectTo,
  label,
  shortLabel,
}: {
  locale: MarketingLocale
  /** Path to come back to after the cookie is set, e.g. "/start". */
  redirectTo: string
  /** Accessible label naming the language the toggle switches to. */
  label: string
  /** Short visible label, e.g. "EN" or "ไทย". */
  shortLabel: string
}) {
  const next: MarketingLocale = locale === 'th' ? 'en' : 'th'
  const href = `/api/auth/locale?locale=${next}&redirect=${encodeURIComponent(redirectTo)}`
  return (
    <a
      href={href}
      className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-2 text-sm font-medium text-[#d5efe6] transition hover:bg-white/10 hover:text-white"
      aria-label={label}
    >
      <Globe className="size-4" />
      {shortLabel}
    </a>
  )
}
