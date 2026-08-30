import Link from 'next/link'
import { cookies } from 'next/headers'
import { IBM_Plex_Sans_Thai } from 'next/font/google'
import { ArrowRight, Landmark, Package, Users, Bot, Check } from 'lucide-react'
import { marketingDict, resolveMarketingLocale } from '../_marketing/i18n'
import { BRAND, MarketingFooter, MarketingNav } from '../_marketing/chrome'

const plexThai = IBM_Plex_Sans_Thai({
  weight: ['400', '500', '600', '700'],
  subsets: ['thai', 'latin'],
  display: 'swap',
})

const WHAT_ICONS = [Landmark, Package, Users, Bot]

export default async function OrvaAboutPage() {
  const locale = resolveMarketingLocale((await cookies()).get('locale')?.value)
  const t = marketingDict[locale]
  const a = t.about

  return (
    <main className={`${plexThai.className} min-h-svh w-full bg-white text-[#101828]`}>
      <MarketingNav locale={locale} dict={t} />

      {/* ───── Header ───── */}
      <section
        className="relative overflow-hidden text-white"
        style={{ background: `linear-gradient(160deg, ${BRAND.deep} 0%, ${BRAND.dark} 70%, ${BRAND.base} 140%)` }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-44 -top-44 size-[480px] rounded-full border-[48px] border-white/5"
        />
        <div className="relative mx-auto max-w-3xl px-6 py-20 text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: BRAND.mint }}>
            {a.kicker}
          </div>
          <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight">{a.title}</h1>
          <p className="mt-5 text-base leading-7 text-[#eafaf4bf]">{a.lead}</p>
        </div>
      </section>

      {/* ───── Mission ───── */}
      <section className="mx-auto max-w-3xl px-6 pt-16">
        <h2 className="text-2xl font-bold tracking-tight">{a.missionTitle}</h2>
        <p className="mt-4 text-[15px] leading-7 text-[#49564f]">{a.missionBody}</p>
      </section>

      {/* ───── What Orva does ───── */}
      <section className="mx-auto max-w-5xl px-6 pt-16">
        <h2 className="text-center text-2xl font-bold tracking-tight">{a.whatTitle}</h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {a.whatItems.map((item, index) => {
            const Icon = WHAT_ICONS[index] ?? Landmark
            return (
              <div key={item.title} className="rounded-2xl border border-[#e3e9e6] bg-white p-7">
                <span className="flex size-10 items-center justify-center rounded-xl" style={{ background: 'rgba(17,131,110,0.09)' }}>
                  <Icon className="size-5" style={{ color: BRAND.base }} />
                </span>
                <h3 className="mt-4 text-base font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[#66756e]">{item.body}</p>
              </div>
            )
          })}
        </div>
      </section>

      {/* ───── Principles ───── */}
      <section className="mx-auto max-w-5xl px-6 pt-16">
        <h2 className="text-center text-2xl font-bold tracking-tight">{a.principlesTitle}</h2>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {a.principles.map((point) => (
            <div key={point.title} className="rounded-2xl border border-[#e3e9e6] bg-[#f6faf8] p-7">
              <Check className="size-5" style={{ color: BRAND.base }} />
              <h3 className="mt-3 text-[15px] font-semibold">{point.title}</h3>
              <p className="mt-2 text-[13px] leading-6 text-[#66756e]">{point.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ───── Company + tech (credit lives here, low-key) ───── */}
      <section className="mx-auto max-w-3xl px-6 pt-16">
        <h2 className="text-2xl font-bold tracking-tight">{a.companyTitle}</h2>
        <p className="mt-4 text-[15px] leading-7 text-[#49564f]">{a.companyBody}</p>
        <div className="mt-10 rounded-2xl border border-[#e3e9e6] bg-[#f6faf8] p-6">
          <h3 className="text-sm font-semibold text-[#49564f]">{a.techTitle}</h3>
          <p className="mt-2 text-[13px] leading-6 text-[#66756e]">
            {a.techBody}{' '}
            <a
              href="https://github.com/open-mercato/open-mercato"
              className="underline decoration-[#cbd6d1] underline-offset-2 transition hover:text-[#101828]"
            >
              open-mercato/open-mercato
            </a>
          </p>
        </div>
      </section>

      {/* ───── CTA ───── */}
      <section className="mx-auto max-w-3xl px-6 pb-24 pt-16 text-center">
        <h2 className="text-2xl font-bold tracking-tight">{a.ctaTitle}</h2>
        <p className="mt-3 text-[15px] text-[#66756e]">{a.ctaBody}</p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/start#screens"
            className="rounded-lg border border-[#cbd6d1] px-7 py-3 text-sm font-semibold text-[#101828] transition hover:bg-[#f6faf8]"
          >
            {a.ctaScreens}
          </Link>
          <Link
            href="/login"
            className="group inline-flex items-center gap-2 rounded-lg px-7 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
            style={{ background: BRAND.base }}
          >
            {a.ctaLogin}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>

      <MarketingFooter dict={t} />
    </main>
  )
}
