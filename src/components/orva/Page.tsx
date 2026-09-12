"use client"
import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'

/**
 * The skeleton every Orva screen stands on.
 *
 * This replaces the installed `Page` / `PageHeader` / `PageBody` — forty-six
 * lines that wrapped children in `space-y-6` and drew a title. Sixty-seven
 * screens import them, which is exactly why they are the thing worth owning:
 * changing the bones once changes every screen, where changing screens one at
 * a time changes the paint.
 *
 * What it adds over the installed version, on every screen at once:
 *
 *   - **The department.** A heading that says "Vendor Bills" answers what the
 *     records are called and leaves out where the operator is standing. The
 *     kicker is read from the route's own `pageGroupKey`, resolved once in the
 *     backend layout and handed down — so no screen has to pass it and none
 *     can forget to.
 *   - **One rhythm.** Header, then body, with the same spacing and the same
 *     rule under the header everywhere. The installed pair left each screen to
 *     choose, and they did.
 *   - **A width.** Long-form screens were full-bleed to whatever the window
 *     was, so a two-column form on a wide monitor ran to 1800px and the eye
 *     lost the line between label and field.
 *
 * The prop signatures match the installed components exactly, so screens move
 * over by changing an import and nothing else.
 */

type PageMeta = { groupLabel?: string; title?: string }

const PageMetaContext = React.createContext<PageMeta>({})

/** Set once by the backend layout, which already resolves the route. */
export function OrvaPageMetaProvider({ value, children }: { value: PageMeta; children: React.ReactNode }) {
  const memo = React.useMemo(() => value, [value.groupLabel, value.title])
  return <PageMetaContext.Provider value={memo}>{children}</PageMetaContext.Provider>
}

export function useOrvaPageMeta(): PageMeta {
  return React.useContext(PageMetaContext)
}

export function Page({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('mx-auto w-full max-w-6xl space-y-6', className)} {...props}>
      {children}
    </div>
  )
}

export function PageHeader({
  /**
   * Optional: a screen that has nothing to add takes its own route's title,
   * which is where the sidebar and the breadcrumb already get it. Twenty-odd
   * screens opened with no head at all — `<PageHeader />` gives them one
   * without anybody inventing a second name for the same page.
   */
  title,
  description,
  actions,
  /** Overrides the department read from the route; rarely needed. */
  kicker,
  /** The figure this screen is about, in ledger numerals beside the title. */
  fact,
}: {
  title?: string
  description?: string
  actions?: React.ReactNode
  kicker?: string
  fact?: React.ReactNode
}) {
  const meta = useOrvaPageMeta()
  const department = kicker ?? meta.groupLabel
  const heading = title ?? meta.title
  if (!heading) return null

  return (
    <header className="flex w-full flex-col gap-3 border-b border-border pb-4">
      {department ? (
        <div className="flex items-center gap-2">
          <span aria-hidden className="size-1.5 rounded-full bg-primary" />
          <span className="orva-kicker">{department}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold leading-tight tracking-tight text-foreground sm:text-2xl">{heading}</h1>
          {fact ? <span className="tabular-nums text-sm text-muted-foreground">{fact}</span> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      {description ? (
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      ) : null}
    </header>
  )
}

export function PageBody({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('space-y-4', className)} {...props}>
      {children}
    </div>
  )
}
