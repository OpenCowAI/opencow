// SPDX-License-Identifier: Apache-2.0

import { Info } from 'lucide-react'

/**
 * Renders an ⓘ icon that reveals a tooltip card on hover.
 *
 * `align`:
 *   - "center" (default) — tooltip is centred on the icon; use for mid-page icons
 *   - "start"            — tooltip left-edge aligns with the icon; opens rightward;
 *                          use when the icon is near the left edge of the container
 *   - "end"              — tooltip right-edge aligns with the icon; opens leftward;
 *                          use when the icon is near the right edge
 */
export function InfoTooltip({
  content,
  align = 'center',
}: {
  content: string
  align?: 'center' | 'start' | 'end'
}): React.JSX.Element {
  const cardPos =
    align === 'start' ? 'left-0' :
    align === 'end'   ? 'right-0' :
    'left-1/2 -translate-x-1/2'

  const arrowPos =
    align === 'start' ? 'left-3' :
    align === 'end'   ? 'right-3' :
    'left-1/2 -translate-x-1/2'

  return (
    <span
      onClick={(e) => e.stopPropagation()}
      className="relative group/tip inline-flex items-center"
    >
      <Info className="h-3 w-3 text-[hsl(var(--muted-foreground)/0.5)] group-hover/tip:text-[hsl(var(--muted-foreground))] transition-colors cursor-help shrink-0" />

      <span
        role="tooltip"
        className={[
          `pointer-events-none absolute bottom-full ${cardPos} mb-2 z-50`,
          'hidden group-hover/tip:block',
          'w-56 p-2.5 rounded-lg shadow-lg',
          'bg-[hsl(var(--popover))] border border-[hsl(var(--border))]',
          'text-left text-[11px] leading-relaxed text-[hsl(var(--foreground))] whitespace-pre-line',
        ].join(' ')}
      >
        {content}
        <span className={`absolute top-full ${arrowPos} border-4 border-transparent border-t-[hsl(var(--border))]`} />
      </span>
    </span>
  )
}
