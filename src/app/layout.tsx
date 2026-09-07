import type { Metadata } from 'next'
import { Anuphan, Sarabun } from 'next/font/google'
import './globals.css'
import '@/lib/i18n/register-dictionary-loader'
import { AppProviders } from '@/components/AppProviders'

// The voice of the product is typographic (docs/BRAND.md, design-language v2):
// the SCREEN speaks Anuphan — a contemporary loopless Thai face that is ours,
// not the grotesk every admin template ships — and PAPER speaks Sarabun, the
// Thai official-document face every accountant already trusts. Document
// templates opt into --font-document; everything else inherits --font-sans.
const anuphan = Anuphan({
  weight: ['400', '500', '600', '700'],
  subsets: ['thai', 'latin'],
  display: 'swap',
  variable: '--font-anuphan',
})
const sarabun = Sarabun({
  weight: ['400', '500', '600', '700'],
  subsets: ['thai', 'latin'],
  display: 'swap',
  variable: '--font-sarabun',
})

import { THEME_INIT_SCRIPT } from '@open-mercato/ui/theme/theme-init-script'
import { detectLocale, loadDictionary } from '@open-mercato/shared/lib/i18n/server'
import { resolveForcedLocale } from '@open-mercato/shared/lib/i18n/locale'

export const metadata: Metadata = {
  title: 'Orva',
  description: 'Orva — AI-native ERP by Anthovai',
  icons: {
    icon: '/orva.svg',
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await detectLocale()
  const dict = await loadDictionary(locale)
  const localeLocked = resolveForcedLocale(process.env) !== null
  const demoModeEnabled = process.env.DEMO_MODE !== 'false'
  const noticeBarsEnabled = process.env.OM_INTEGRATION_TEST !== 'true'
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${anuphan.variable} ${sarabun.variable} font-sans antialiased`} suppressHydrationWarning data-gramm="false">
        {/*
          A plain, non-deferred script, on purpose.

          Next 16 logs "Encountered a script tag while rendering React
          component … Consider using template tag instead" in dev for this
          line. The warning is about client renders, where an inline script
          would not execute — which is exactly why this one does not need to:
          it runs once, while the browser parses the document, before the
          first paint, which is the only moment it is any use.

          Do NOT move it to `next/script`. `THEME_INIT_SCRIPT`'s own doc
          comment in @open-mercato/ui spells out why: with
          strategy="beforeInteractive" the App Router only queues the code on
          `self.__next_s` for the client runtime to replay after hydration
          starts, so the page paints light and then flashes to dark. A dev
          console warning is a smaller cost than that flash on every load.

          A `<template>`, as the warning suggests, would never execute at all.
        */}
        <script id="om-theme-init" dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <AppProviders locale={locale} dict={dict} localeLocked={localeLocked} demoModeEnabled={demoModeEnabled} noticeBarsEnabled={noticeBarsEnabled}>
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
