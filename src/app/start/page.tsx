import Image from 'next/image'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { IBM_Plex_Sans_Thai } from 'next/font/google'
import {
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  FileText,
  Landmark,
  Lock,
  Package,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react'
import { marketingDict, resolveMarketingLocale } from '../_marketing/i18n'
import { BRAND, MarketingFooter, MarketingNav } from '../_marketing/chrome'

const plexThai = IBM_Plex_Sans_Thai({
  weight: ['400', '500', '600', '700'],
  subsets: ['thai', 'latin'],
  display: 'swap',
})

const FINANCE_ICONS = [Landmark, FileText, Wallet, BarChart3]
const SUITE_ICONS = [Package, Users, Bot]
const ARCH_ICONS = [ShieldCheck, Lock, Bot]

function BrowserFrame({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-black/10 bg-white shadow-2xl shadow-[#06342c33]">
      <div className="flex items-center gap-1.5 border-b border-black/5 bg-[#f6faf8] px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-[#f66]" />
        <span className="size-2.5 rounded-full bg-[#fc3]" />
        <span className="size-2.5 rounded-full bg-[#4c4]" />
        <span className="ml-3 hidden rounded-md bg-white px-3 py-0.5 text-[11px] text-[#94a19b] ring-1 ring-black/5 sm:block">
          app.orva.co
        </span>
      </div>
      <Image src={src} alt={alt} width={1440} height={900} className="w-full" />
    </div>
  )
}

export default async function OrvaStartPage() {
  const locale = resolveMarketingLocale((await cookies()).get('locale')?.value)
  const t = marketingDict[locale]

  return (
    <main className={`${plexThai.className} min-h-svh w-full bg-white text-[#101828]`}>
      <MarketingNav locale={locale} dict={t} />

      {/* ───── Hero (dark brand) ───── */}
      <section
        className="relative overflow-hidden text-white"
        style={{ background: `linear-gradient(160deg, ${BRAND.deep} 0%, ${BRAND.dark} 55%, ${BRAND.base} 130%)` }}
      >
        {/* decorative ring echoing the logomark */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-40 -top-40 size-[560px] rounded-full border-[54px] border-white/5"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-52 bottom-0 size-[420px] rounded-full border-[44px] border-white/[0.04]"
        />
        <div className="relative mx-auto flex max-w-6xl flex-col items-center px-6 pb-0 pt-20 text-center">
          <span className="rounded-full border border-[#7ee0c440] bg-[#7ee0c41a] px-4 py-1.5 text-xs font-medium text-[#d5efe6]">
            {t.hero.badge}
          </span>
          <h1 className="mt-6 max-w-3xl text-4xl font-bold leading-[1.15] tracking-tight sm:text-[3.4rem]">
            {t.hero.title}
          </h1>
          <p className="mt-3 max-w-2xl text-lg font-medium" style={{ color: BRAND.mint }}>
            {t.hero.subtitle}
          </p>
          <p className="mt-5 max-w-2xl text-base leading-7 text-[#eafaf4bf]">{t.hero.body}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/login"
              className="group inline-flex items-center gap-2 rounded-lg bg-white px-7 py-3 text-sm font-semibold text-[#06342c] shadow-lg transition hover:bg-[#e9f7f1]"
            >
              {t.hero.ctaStart}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#screens"
              className="rounded-lg border border-white/25 px-7 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              {t.hero.ctaScreens}
            </a>
          </div>
          <ul className="mt-8 flex flex-wrap justify-center gap-x-7 gap-y-2 text-[13px] text-[#eafaf4b3]">
            {t.hero.trust.map((point) => (
              <li key={point} className="flex items-center gap-1.5">
                <Check className="size-3.5" style={{ color: BRAND.mint }} />
                {point}
              </li>
            ))}
          </ul>

          {/* mock peeking out of the hero */}
          <div className="relative z-10 mt-14 w-full max-w-4xl translate-y-16 sm:translate-y-20">
            <BrowserFrame src="/marketing/screen-finance.png" alt={t.hero.financeAlt} />
          </div>
        </div>
      </section>

      {/* spacer for the overlapping mock */}
      <div className="h-24 sm:h-28" />

      {/* ───── Stats ───── */}
      <section className="mx-auto max-w-6xl px-6">
        <div className="grid grid-cols-2 gap-y-8 rounded-2xl border border-[#e3e9e6] bg-[#f6faf8] px-6 py-10 md:grid-cols-4">
          {t.stats.map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-[2rem] font-bold tabular-nums" style={{ color: BRAND.base }}>
                {stat.value}
              </div>
              <div className="mt-1 text-[13px] leading-5 text-[#66756e]">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ───── Modules ───── */}
      <section id="modules" className="mx-auto max-w-6xl scroll-mt-24 px-6 pt-24">
        <div className="text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: BRAND.base }}>
            {t.modules.kicker}
          </div>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">{t.modules.title}</h2>
          <p className="mx-auto mt-3 max-w-xl text-[15px] text-[#66756e]">{t.modules.subtitle}</p>
        </div>

        {/* Finance core */}
        <div
          className="mt-10 rounded-2xl p-8 text-white"
          style={{ background: `linear-gradient(150deg, ${BRAND.dark}, ${BRAND.deep})` }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-white/10">
              <Landmark className="size-5" style={{ color: BRAND.mint }} />
            </span>
            <h3 className="text-xl font-semibold">{t.modules.financeTitle}</h3>
            <span
              className="rounded-full px-3 py-1 text-xs font-semibold"
              style={{ background: 'rgba(126,224,196,0.15)', color: BRAND.mint }}
            >
              {t.modules.financeBadge}
            </span>
          </div>
          <div className="mt-7 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
            {t.modules.financeItems.map((item, index) => {
              const Icon = FINANCE_ICONS[index] ?? Landmark
              return (
                <div key={item.title}>
                  <Icon className="size-5" style={{ color: BRAND.mint }} />
                  <h4 className="mt-2.5 text-[15px] font-semibold">{item.title}</h4>
                  <p className="mt-1.5 text-[13px] leading-5 text-[#eafaf4a6]">{item.body}</p>
                </div>
              )
            })}
          </div>
        </div>

        {/* Suites */}
        <div className="mt-5 grid gap-5 md:grid-cols-3">
          {t.modules.suites.map((suite, index) => {
            const Icon = SUITE_ICONS[index] ?? Package
            return (
              <div
                key={suite.title}
                className="rounded-2xl border border-[#e3e9e6] bg-white p-7 transition hover:border-[#cbd6d1] hover:shadow-lg hover:shadow-[#dfe7e3]"
              >
                <span className="flex size-10 items-center justify-center rounded-xl" style={{ background: 'rgba(17,131,110,0.09)' }}>
                  <Icon className="size-5" style={{ color: BRAND.base }} />
                </span>
                <h3 className="mt-4 text-base font-semibold">{suite.title}</h3>
                <ul className="mt-3 flex flex-col gap-2.5 text-sm text-[#49564f]">
                  {suite.items.map((item) => (
                    <li key={item} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 size-4 shrink-0" style={{ color: BRAND.base }} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </section>

      {/* ───── Screens ───── */}
      <section id="screens" className="mx-auto max-w-6xl scroll-mt-24 px-6 pt-24">
        <div className="text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: BRAND.base }}>
            {t.screens.kicker}
          </div>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">{t.screens.title}</h2>
        </div>
        <div className="mt-10 grid items-start gap-10 lg:grid-cols-2">
          <figure className="flex flex-col gap-4">
            <BrowserFrame src="/marketing/screen-finance.png" alt={t.hero.financeAlt} />
            <figcaption className="text-sm leading-6 text-[#66756e]">
              <span className="font-semibold text-[#101828]">{t.screens.cap1Title}</span> — {t.screens.cap1Body}
            </figcaption>
          </figure>
          <figure className="flex flex-col gap-4">
            <BrowserFrame src="/marketing/screen-payroll.png" alt={t.hero.payrollAlt} />
            <figcaption className="text-sm leading-6 text-[#66756e]">
              <span className="font-semibold text-[#101828]">{t.screens.cap2Title}</span> — {t.screens.cap2Body}
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ───── Architecture ───── */}
      <section id="architecture" className="mx-auto max-w-6xl scroll-mt-24 px-6 pt-24">
        <div className="text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: BRAND.base }}>
            {t.architecture.kicker}
          </div>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">{t.architecture.title}</h2>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {t.architecture.points.map((point, index) => {
            const Icon = ARCH_ICONS[index] ?? ShieldCheck
            return (
              <div key={point.title} className="rounded-2xl border border-[#e3e9e6] bg-[#f6faf8] p-7">
                <Icon className="size-6" style={{ color: BRAND.base }} />
                <h3 className="mt-4 text-[15px] font-semibold">{point.title}</h3>
                <p className="mt-2 text-[13px] leading-6 text-[#66756e]">{point.body}</p>
              </div>
            )
          })}
        </div>
        <p className="mt-8 text-center text-xs tracking-wide text-[#94a19b]">{t.architecture.techLine}</p>
      </section>

      {/* ───── CTA ───── */}
      <section className="mx-auto max-w-6xl px-6 pb-24 pt-24">
        <div
          className="relative overflow-hidden rounded-2xl px-8 py-16 text-center text-white"
          style={{ background: `linear-gradient(150deg, ${BRAND.deep}, ${BRAND.base})` }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full border-[36px] border-white/10"
          />
          <h2 className="text-3xl font-bold tracking-tight">{t.cta.title}</h2>
          <p className="mx-auto mt-3 max-w-xl text-[15px] text-[#eafaf4cc]">{t.cta.body}</p>
          <Link
            href="/login"
            className="group mt-8 inline-flex items-center gap-2 rounded-lg bg-white px-8 py-3 text-sm font-semibold text-[#06342c] shadow-lg transition hover:bg-[#e9f7f1]"
          >
            {t.cta.button}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>

      <MarketingFooter dict={t} />
    </main>
  )
}
