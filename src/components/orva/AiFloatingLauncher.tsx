'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { AI_ASSISTANT_LAUNCHER_OPEN_EVENT } from '@open-mercato/ui/ai/AiAssistantLauncher'
import { AiIcon } from '@open-mercato/ui/ai/AiIcon'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * The AI assistant, out of the header and into the corner.
 *
 * The owner asked for the assistant to stop taking header room next to the
 * organisation switcher and the bell, and to live as a small icon at the
 * bottom instead. The installed launcher stays mounted in the app shell — it
 * owns the agent picker, the chat sheet and Cmd/Ctrl+L — and is asked to open
 * through the event it already listens to; its own header pill is hidden in
 * globals.css. So nothing about the assistant changed, only where it is
 * reached from.
 *
 * Whether the assistant is available at all (provider configured, agents the
 * caller may use) is the launcher's decision, taken from its own endpoints;
 * rather than repeat those calls, this icon shows exactly when the launcher
 * has rendered its (hidden) trigger, and not otherwise.
 */
const TRIGGER = '[data-ai-launcher-trigger]'

export function AiFloatingLauncher() {
  const t = useT()
  const [available, setAvailable] = React.useState(false)

  React.useEffect(() => {
    const check = () => setAvailable(Boolean(document.querySelector(TRIGGER)))
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.querySelector('header') ?? document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  if (!available) return null
  const label = t('orva.ai.launcher', 'เปิดผู้ช่วย AI (Ctrl+L)')
  // Portalled to <body>: the header it is rendered from is a positioned,
  // transformed ancestor, which would pin a `fixed` child to the header
  // instead of the viewport.
  return createPortal(
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(AI_ASSISTANT_LAUNCHER_OPEN_EVENT))}
      aria-label={label}
      title={label}
      data-orva-ai-launcher=""
      className="fixed bottom-5 right-5 z-banner inline-flex size-10 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 print:hidden"
    >
      <AiIcon className="size-4" />
    </button>,
    document.body,
  )
}
