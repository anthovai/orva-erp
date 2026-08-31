"use client"
import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'

/**
 * Orva node language (docs/BRAND.md §"The mint node").
 *
 * The logomark is an open ring with a single mint node sitting in the gap.
 * That node is the product's visual shorthand for "a connection / a module /
 * something the system is doing", so these components reuse it for the two
 * places every ERP screen falls back to — nothing here yet, and working on it
 * — instead of a generic box-with-an-icon.
 *
 * Colours come from the theme tokens, so the marks follow light/dark and any
 * future palette change without edits here.
 */

export type NodeMarkProps = {
  /** Rendered size in px. */
  size?: number
  className?: string
}

/**
 * The logomark's ring + node, drawn with the current text colour for the ring
 * and the brand accent for the node.
 */
export function OrvaNodeMark({ size = 56, className }: NodeMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="presentation"
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      <path
        d="M243.79 116.53 A140 140 0 1 0 382.88 196.84"
        fill="none"
        stroke="currentColor"
        strokeWidth={52}
        strokeLinecap="round"
        opacity={0.28}
      />
      <circle cx={326} cy={134.76} r={32} className="fill-primary" />
    </svg>
  )
}

/**
 * Three nodes travelling along a connector — the automation diagram from the
 * brand book, animated. Used while a screen is fetching.
 */
export function OrvaNodeLoader({ className, label }: { className?: string; label?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-3', className)} role="status" aria-live="polite">
      <svg width={72} height={16} viewBox="0 0 72 16" aria-hidden="true">
        <line x1="8" y1="8" x2="64" y2="8" stroke="currentColor" strokeWidth={1.5} opacity={0.2} />
        {[8, 36, 64].map((cx, index) => (
          <circle key={cx} cx={cx} cy={8} r={5} className="fill-primary">
            <animate
              attributeName="opacity"
              values="0.25;1;0.25"
              dur="1.2s"
              begin={`${index * 0.2}s`}
              repeatCount="indefinite"
            />
          </circle>
        ))}
      </svg>
      {label ? <span className="text-sm text-muted-foreground">{label}</span> : null}
    </div>
  )
}

export type OrvaEmptyStateProps = {
  title: string
  description?: string
  /** Primary call to action, e.g. a <Button asChild><Link/></Button>. */
  action?: React.ReactNode
  className?: string
}

/** Empty state carrying the logomark instead of a generic placeholder icon. */
export function OrvaEmptyState({ title, description, action, className }: OrvaEmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-10 text-center', className)}>
      <OrvaNodeMark size={52} className="text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}
