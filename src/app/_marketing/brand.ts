// Orva CI palette for the marketing surface — see docs/BRAND.md
// (Orva Green / Orva Forest / Orva Mint; `deep` is the one-step-darker
// background shade used in gradients).
//
// Its own module rather than a const inside `chrome.tsx` so a component that
// chrome renders can paint with it too, without importing its own parent.
export const BRAND = {
  deep: '#0A3D33',
  dark: '#0E4A3E',
  base: '#11836E',
  mint: '#7EE0C4',
  /** Body text on a white card, matching the marketing pages' foreground. */
  ink: '#101828',
  /** Faint green wash for a hovered row on a white card. */
  wash: '#F2F7F5',
  /** Nav text on the dark header. */
  onDark: '#D5EFE6',
} as const
