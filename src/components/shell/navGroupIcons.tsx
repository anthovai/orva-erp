import * as React from 'react'
import {
  Banknote,
  BarChart3,
  Boxes,
  Handshake,
  LayoutList,
  MessageCircle,
  Settings,
  ShoppingCart,
  UserRound,
} from 'lucide-react'

/**
 * One icon per sidebar group — and none anywhere else.
 *
 * The inherited shell did the opposite: an icon on every one of the forty-odd
 * items and none on the headings. At that density an icon stops being a
 * signpost and becomes texture, which is why the same glyphs were reused
 * without anyone noticing — `file-text` on three different pages, `receipt` on
 * three more, `book-open`, `banknote`, `hand-coins` and `key-round` on two
 * each. A reader scanning for "Vendor Bills" was matching the word anyway.
 *
 * Market ERPs settle this the same way: the department carries a mark, the
 * pages under it are a plain list. Nine marks are learnable; forty-one are
 * wallpaper. It also means a new page costs nobody an icon decision — the
 * group it joins already has one.
 *
 * Keyed by group id, which is the `pageGroupKey` a page declares (see
 * `src/modules.ts` → NAV). A group with no entry here renders its label alone
 * rather than a placeholder, because a shared fallback glyph on several groups
 * would be exactly the noise this is removing.
 */
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'orva.nav.sales': ShoppingCart,
  'orva.nav.project': LayoutList,
  'orva.nav.purchasing': Handshake,
  'orva.nav.stock': Boxes,
  'orva.nav.accounting': Banknote,
  'orva.nav.reports': BarChart3,
  'orva.nav.hr': UserRound,
  'orva.nav.marketing': MessageCircle,
  'orva.nav.settings': Settings,
}

export function NavGroupIcon({ groupId }: { groupId: string }): React.ReactElement | null {
  const Icon = ICONS[groupId]
  if (!Icon) return null
  return <Icon className="size-4 shrink-0" aria-hidden />
}

/** Whether a group carries a mark at all — used to keep labels aligned. */
export const hasGroupIcon = (groupId: string): boolean => Boolean(ICONS[groupId])

export const NAV_GROUP_ICON_IDS = Object.keys(ICONS)
