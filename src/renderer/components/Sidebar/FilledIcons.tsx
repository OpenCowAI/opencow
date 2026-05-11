// SPDX-License-Identifier: Apache-2.0

/**
 * Duotone "filled" variant of `lucide-react`'s `Inbox` icon.
 *
 * Plain `fill-current` would erase the tray-opening polyline on the
 * envelope's front face and collapse the icon into a blob. Here the
 * outer envelope is filled with `currentColor` and the opening is
 * redrawn in `--sidebar-background` as a negative-space cutout.
 *
 * Negative-space color is locked to `--sidebar-background` because
 * this icon is sidebar-only. Parametrise if reused elsewhere.
 *
 * `FolderClosedFilled` previously had a sibling variant here — it was
 * retired when the "Projects" entry switched to plain `Folder`
 * (single-path icon with no interior detail, fills cleanly via plain
 * `fill-current`).
 */

import { cn } from '@/lib/utils'

const SVG_PROPS = {
  xmlns: 'http://www.w3.org/2000/svg',
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
} as const

const NEGATIVE_SPACE = 'hsl(var(--sidebar-background))'

// Path data lifted verbatim from `lucide-react@0.575.0`
// `dist/esm/icons/inbox.js`. Keep these strings in sync when bumping
// the lucide dependency to avoid drift between the filled and outline
// variants of the same icon.
const INBOX_OUTER =
  'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'
const INBOX_TRAY_OPENING = '22 12 16 12 14 15 10 15 8 12 2 12'

export function InboxFilled({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg {...SVG_PROPS} className={cn(className)} aria-hidden="true">
      {/* Envelope outer — solid fill */}
      <path d={INBOX_OUTER} fill="currentColor" stroke="currentColor" />
      {/* Tray opening polyline — negative space U-shape on the front face */}
      <polyline points={INBOX_TRAY_OPENING} stroke={NEGATIVE_SPACE} />
    </svg>
  )
}
