"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Globe } from 'lucide-react'
import type { MarketingLocale } from './i18n'

/**
 * Minimal locale toggle for the marketing pages. Writes the same `locale`
 * cookie the app's dictionary loader reads, so the choice carries into the
 * backoffice after login.
 */
export function LanguageSwitcher({ locale }: { locale: MarketingLocale }) {
  const router = useRouter()
  const next: MarketingLocale = locale === 'th' ? 'en' : 'th'
  return (
    <button
      type="button"
      onClick={() => {
        document.cookie = `locale=${next}; path=/; max-age=31536000`
        router.refresh()
      }}
      className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-2 text-sm font-medium text-[#d5efe6] transition hover:bg-white/10 hover:text-white"
      aria-label={locale === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
    >
      <Globe className="size-4" />
      {locale === 'th' ? 'EN' : 'ไทย'}
    </button>
  )
}
