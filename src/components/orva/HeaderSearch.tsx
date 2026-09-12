'use client'

import dynamic from 'next/dynamic'
import * as React from 'react'
import { Search } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'

const LazyTopbarSearchInline = dynamic(
  () => import('@open-mercato/search/modules/search/frontend').then((module) => module.TopbarSearchInline),
  { ssr: false, loading: () => null },
)

/**
 * Global search, given the room a first-class feature is supposed to have.
 *
 * `design.md` §5 makes search one thing that reaches across employees,
 * customers, projects, invoices, tickets and documents, and §6 puts a command
 * palette on ⌘K. Both already existed here — and sat as a 260px box wedged
 * between six icons at the far right of the header, which is where a feature
 * goes to be mistaken for a filter.
 *
 * It moves to the left, beside the breadcrumb, so the first thing on the bar
 * is the way into everything. The component brings its own ⌘K handler.
 */
export function OrvaHeaderSearch({
  embeddingConfigured,
  missingConfigMessage,
}: {
  embeddingConfigured: boolean
  missingConfigMessage: string
}) {
  const t = useT()
  const [engaged, setEngaged] = React.useState(false)

  // The installed search starts collapsed as an icon and expands on click or
  // on ⌘K, which it listens for on `window` itself. The reference design wants
  // a field resting open, so a resting field is what shows — and pressing it
  // fires that same ⌘K, the component's own public trigger, rather than
  // reaching into its state.
  const open = React.useCallback(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true }))
  }, [])

  // One source of truth for which of the two is showing: the real search's own
  // `data-search-expanded`. Tracking it here as well would mean two answers,
  // and ⌘K pressed anywhere else on the page would desync them.
  React.useEffect(() => {
    const check = () => setEngaged(Boolean(document.querySelector('[data-search-expanded="true"]')))
    check()
    const timer = setInterval(check, 250)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="hidden min-w-0 flex-1 sm:flex sm:max-w-md lg:max-w-lg">
      {engaged ? null : (
        <button
          type="button"
          onClick={open}
          className="flex h-9 w-full items-center gap-2 rounded-lg border bg-muted/40 px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            {t('orva.header.searchPlaceholder', 'ค้นหาทุกอย่าง')}
          </span>
          <kbd className="hidden shrink-0 rounded border bg-background px-1.5 py-0.5 font-sans text-xs text-muted-foreground md:inline-block">
            ⌘K
          </kbd>
        </button>
      )}
      {/* Always mounted, so its ⌘K listener is alive even while the resting
          field is the thing on screen; hidden rather than unmounted for the
          same reason. */}
      <div className={engaged ? 'flex min-w-0 flex-1' : 'sr-only'}>
        <LazyTopbarSearchInline
          embeddingConfigured={embeddingConfigured}
          missingConfigMessage={missingConfigMessage}
        />
      </div>
    </div>
  )
}

/**
 * The date, as the reference design carries it.
 *
 * Thai renders the Buddhist year, which is what every document this system
 * prints uses — a header showing 2026 beside invoices dated 2569 would be the
 * product disagreeing with itself.
 */
export function OrvaHeaderClock() {
  const locale = useLocale()
  const t = useT()
  const [now, setNow] = React.useState<Date | null>(null)

  // Set on the client only: rendering a clock on the server guarantees a
  // hydration mismatch, since the two run at different moments.
  React.useEffect(() => {
    setNow(new Date())
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])

  if (!now) return null
  const calendar = locale === 'th' ? 'th-TH-u-ca-buddhist' : locale
  return (
    <div className="hidden text-right leading-tight xl:block" aria-label={t('orva.header.today', 'วันนี้')}>
      <div className="text-xs font-medium text-foreground">
        {new Intl.DateTimeFormat(calendar, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(now)}
      </div>
      <div className="text-xs tabular-nums text-muted-foreground">
        {new Intl.DateTimeFormat(calendar, { hour: '2-digit', minute: '2-digit' }).format(now)}
      </div>
    </div>
  )
}
