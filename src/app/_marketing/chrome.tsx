import Image from 'next/image'
import Link from 'next/link'
import type { MarketingDict, MarketingLocale } from './i18n'
import { LanguageSwitcher } from './LanguageSwitcher'

// Orva CI palette — see docs/BRAND.md (Orva Green / Orva Forest / Orva Mint;
// `deep` is the one-step-darker background shade used in gradients).
export const BRAND = {
  deep: '#0A3D33',
  dark: '#0E4A3E',
  base: '#11836E',
  mint: '#7EE0C4',
}

/**
 * Shared marketing navbar. Section anchors point at the landing page so the
 * same nav works from /start and /about.
 */
export function MarketingNav({ locale, dict }: { locale: MarketingLocale; dict: MarketingDict }) {
  return (
    <header
      className="sticky top-0 z-30 border-b border-white/10"
      style={{ background: 'rgba(9,45,38,0.85)', backdropFilter: 'blur(12px)' }}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/start" className="flex items-center gap-2.5">
          <Image src="/orva.svg" alt="Orva" width={32} height={32} />
          <span className="text-lg font-bold tracking-tight text-white">Orva</span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm font-medium text-[#d5efe6cc] md:flex">
          <Link href="/start#modules" className="transition hover:text-white">{dict.nav.modules}</Link>
          <Link href="/start#screens" className="transition hover:text-white">{dict.nav.screens}</Link>
          <Link href="/start#architecture" className="transition hover:text-white">{dict.nav.architecture}</Link>
          <Link href="/about" className="transition hover:text-white">{dict.nav.about}</Link>
        </nav>
        <div className="flex items-center gap-3">
          <LanguageSwitcher locale={locale} />
          <Link
            href="/backend"
            className="hidden text-sm font-medium text-[#d5efe6cc] transition hover:text-white sm:block"
          >
            {dict.nav.admin}
          </Link>
          <Link
            href="/login"
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#06342c] shadow-sm transition hover:bg-[#e9f7f1]"
          >
            {dict.nav.login}
          </Link>
        </div>
      </div>
    </header>
  )
}

export function MarketingFooter({ dict }: { dict: MarketingDict }) {
  return (
    <footer className="text-[#eafaf4b3]" style={{ background: BRAND.deep }}>
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 text-sm sm:grid-cols-2 md:grid-cols-4">
        <div>
          <div className="flex items-center gap-2.5">
            <Image src="/orva.svg" alt="Orva" width={30} height={30} />
            <span className="text-base font-bold text-white">Orva</span>
          </div>
          <p className="mt-3 text-[13px] leading-6 text-[#eafaf48c]">{dict.footer.tagline}</p>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.15em] text-[#eafaf466]">{dict.footer.product}</div>
          <ul className="mt-4 flex flex-col gap-2.5">
            <li><Link href="/start#modules" className="transition hover:text-white">{dict.footer.allModules}</Link></li>
            <li><Link href="/start#screens" className="transition hover:text-white">{dict.footer.screens}</Link></li>
            <li><Link href="/start#architecture" className="transition hover:text-white">{dict.footer.architecture}</Link></li>
            <li><Link href="/about" className="transition hover:text-white">{dict.footer.about}</Link></li>
          </ul>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.15em] text-[#eafaf466]">{dict.footer.getStarted}</div>
          <ul className="mt-4 flex flex-col gap-2.5">
            <li><Link href="/login" className="transition hover:text-white">{dict.footer.login}</Link></li>
            <li><Link href="/backend" className="transition hover:text-white">{dict.footer.admin}</Link></li>
            {/* API docs are served by a route handler, not a page — a plain
                anchor is correct here; Link would prefetch a non-page route. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <li><a href="/api/docs/openapi" className="transition hover:text-white">{dict.footer.api}</a></li>
          </ul>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.15em] text-[#eafaf466]">{dict.footer.company}</div>
          <ul className="mt-4 flex flex-col gap-2.5">
            <li>Anthovai</li>
            <li>
              <a href="https://github.com/anthovai/orva-erp" className="transition hover:text-white">GitHub</a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 py-5 text-center text-xs text-[#eafaf466]">
        {dict.footer.copyright}
      </div>
    </footer>
  )
}
