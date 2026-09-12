"use client"
import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'

/**
 * The head of an Orva screen.
 *
 * Every list in this app was the installed `DataTable` and nothing else: it
 * took a `title` string, drew it small above a bordered card, and the page was
 * the grid. That is a component rendering, not a screen — and it is why these
 * pages read as the framework with a green accent rather than as Orva.
 *
 * What an ERP list actually has to answer, before anyone reads a row, is two
 * questions: where am I, and what is the state of this whole thing. So the
 * header states the department it belongs to, the name of the record set, and
 * **the fact** — the count, the total, whatever number the operator came to
 * see — in ledger figures. `docs/BRAND.md` reserves the mint node for "a
 * connection, a module, something the system is doing"; a screen of the
 * system's own is exactly that, so the kicker carries one. Until now the node
 * language only appeared in empty states, which nobody sees once there is
 * data — the product's own voice was visible only when it had nothing to say.
 *
 * Deliberately not a card. A card around a header stacks a border inside a
 * border once the table below draws its own, which is the look this replaces.
 * One hairline closes the header off and the body sits under it.
 */

export type OrvaPageHeaderProps = {
  /** The department this screen belongs to — small caps above the title. */
  kicker?: string
  title: string
  /**
   * The number the operator came for, already formatted. Rendered in tabular
   * figures beside the title. Keep it to facts the page already knows; a
   * header is the wrong place to start a second query.
   */
  fact?: React.ReactNode
  /** One sentence, only when the title genuinely needs it. */
  description?: string
  /** Primary action, right-aligned on the title row. */
  actions?: React.ReactNode
  /**
   * Rendered inside a host that already draws its own separator — the
   * installed DataTable's title slot, which is where our list screens put
   * this. Without it the header's rule and the toolbar's rule stack into a
   * double line two pixels apart.
   */
  embedded?: boolean
  className?: string
}

export function OrvaPageHeader({
  kicker,
  title,
  fact,
  description,
  actions,
  embedded = false,
  className,
}: OrvaPageHeaderProps) {
  return (
    <header className={cn('flex w-full flex-col gap-3', embedded ? 'pb-1' : 'border-b border-border pb-4', className)}>
      {kicker ? (
        <div className="flex items-center gap-2">
          <span aria-hidden className="size-1.5 rounded-full bg-primary" />
          <span className="orva-kicker">{kicker}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          {fact ? (
            <span className="tabular-nums text-sm text-muted-foreground">{fact}</span>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>

      {description ? (
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      ) : null}
    </header>
  )
}
