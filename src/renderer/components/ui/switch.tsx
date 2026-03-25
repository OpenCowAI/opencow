// SPDX-License-Identifier: Apache-2.0

import { cn } from '@/lib/utils'

/**
 * Minimal toggle switch with proper ARIA semantics.
 *
 * ## Sizing model (single source of truth)
 *
 * Independent parameters per size preset:
 *   trackW  — outer pill width  (px)
 *   trackH  — outer pill height (px)
 *   gap     — inset between thumb edge and track edge (px)
 *
 * Derived (computed, never specified manually):
 *   thumbSize = trackH − 2 × gap
 *   travel    = trackW − thumbSize − 2 × gap
 *
 * The gap is realised via CSS `padding` on the track element, so the
 * box-model guarantees uniform spacing on all four sides.  The thumb
 * slides inside the padded content area via `transform: translateX`.
 *
 * Sizes:
 * - `sm`: 28 × 16, gap 3 — inline use in cards
 * - `md`: 34 × 20, gap 3 — detail panels
 */

// ── Props ──────────────────────────────────────────────────────────

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  size?: 'sm' | 'md'
  disabled?: boolean
  label?: string
  className?: string
}

// ── Sizing spec ────────────────────────────────────────────────────

interface SizeSpec {
  trackW: number
  trackH: number
  gap: number
}

const SIZES: Record<'sm' | 'md', SizeSpec> = {
  sm: { trackW: 28, trackH: 16, gap: 3 },
  md: { trackW: 34, trackH: 20, gap: 3 },
}

function deriveMetrics(spec: SizeSpec) {
  const thumbSize = spec.trackH - 2 * spec.gap
  const travel = spec.trackW - thumbSize - 2 * spec.gap
  return { ...spec, thumbSize, travel }
}

// ── Component ──────────────────────────────────────────────────────

export function Switch({
  checked,
  onChange,
  size = 'sm',
  disabled = false,
  label,
  className,
}: SwitchProps): React.JSX.Element {
  const { trackW, trackH, gap, thumbSize, travel } = deriveMetrics(SIZES[size])

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      style={{ width: trackW, height: trackH, padding: gap }}
      className={cn(
        'rounded-full flex items-center transition-colors outline-none',
        'focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
        checked
          ? 'bg-emerald-500'
          : 'bg-[hsl(var(--muted-foreground)/0.2)]',
        disabled && 'opacity-50 cursor-not-allowed',
        className,
      )}
    >
      <span
        style={{
          width: thumbSize,
          height: thumbSize,
          transform: `translateX(${checked ? travel : 0}px)`,
        }}
        className="block rounded-full bg-white shadow-sm transition-transform"
      />
    </button>
  )
}
