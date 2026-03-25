// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { Plus, Sparkles } from 'lucide-react'
import type { CategoryConfig } from './categoryRegistry'

// ── Per-category HSL glow colors ───────────────────────────────────────────
// Matches each category's Tailwind color palette (amber, blue, purple, etc.)
// Used for ambient gradient, glow ring, and perspective grid tint.

const GLOW_HSL: Record<string, string> = {
  skill: '38 92% 50%', // amber
  command: '217 91% 60%', // blue
  agent: '270 70% 60%', // purple
  rule: '25 95% 53%', // orange
  'mcp-server': '187 85% 53%', // cyan
  hook: '142 71% 45%' // green
}

interface CategoryEmptyStateProps {
  config: CategoryConfig
  onCreate?: () => void
  onAICreate?: () => void
}

/**
 * World-class empty state for a capability category.
 *
 * Visual layers (back → front):
 *  1. Perspective grid — tilted grid lines, category-colored, radial mask fade
 *  2. Ambient radial gradient — soft depth emanating from center
 *  3. Content — icon (glow ring) → title → separator → description → CTA
 */
export function CategoryEmptyState({
  config,
  onCreate,
  onAICreate
}: CategoryEmptyStateProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const Icon = config.icon
  const glow = GLOW_HSL[config.id] ?? '220 70% 55%'

  return (
    <div className="flex-1 flex items-center justify-center p-8 relative overflow-hidden">
      {/* ── Layer 1: Perspective grid ──
           Tilted grid lines with category color, fading radially from center.
           Creates a subtle 3D depth plane behind the content. */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute"
          style={{
            inset: '-60%',
            backgroundImage: `
              linear-gradient(hsl(${glow} / 0.18) 1px, transparent 1px),
              linear-gradient(90deg, hsl(${glow} / 0.18) 1px, transparent 1px)
            `,
            backgroundSize: '44px 44px',
            backgroundPosition: 'center center',
            transform: 'perspective(500px) rotateX(60deg)',
            transformOrigin: '50% 55%',
            maskImage: 'radial-gradient(ellipse 45% 40% at 50% 50%, black, transparent)',
            WebkitMaskImage: 'radial-gradient(ellipse 45% 40% at 50% 50%, black, transparent)'
          }}
        />
      </div>

      {/* ── Layer 2: Ambient radial gradient ── subtle depth from center */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(600px circle at 50% 38%, hsl(${glow} / 0.06), transparent 70%)`
        }}
      />

      {/* ── Layer 3: Content ───────────────────────────────────────── */}
      <div className="relative max-w-xs w-full text-center">
        {/* Icon with glow ring */}
        <div className="capability-stagger-1 flex justify-center mb-8">
          <div className="relative group">
            {/* Outer glow ring — breathing animation + hover amplification */}
            <div
              className="capability-glow-ring absolute -inset-3.5 rounded-[26px] transition-all duration-500 group-hover:opacity-100 group-hover:scale-110"
              style={{
                background: `radial-gradient(circle, hsl(${glow} / 0.12), transparent 70%)`,
                boxShadow: `0 0 40px hsl(${glow} / 0.08)`
              }}
            />

            {/* Icon container — glass-like feel */}
            <div
              className={`
                relative p-6 rounded-2xl ${config.bgColor}
                transition-shadow duration-300
                group-hover:shadow-lg
              `}
              style={{
                boxShadow: `
                  0 0 0 1px hsl(${glow} / 0.1),
                  0 2px 12px hsl(${glow} / 0.06)
                `
              }}
            >
              <Icon className={`h-10 w-10 ${config.textColor}`} />
            </div>
          </div>
        </div>

        {/* Title */}
        <div className="capability-stagger-2 mb-3">
          <h3 className="text-lg font-semibold tracking-tight text-[hsl(var(--foreground))]">
            {t(`capabilityCenter.categories.${config.titleKey}`)}
          </h3>
        </div>

        {/* Decorative separator — dot ornament between two lines */}
        <div className="capability-stagger-2 flex items-center gap-3 mx-auto max-w-[100px] mb-4">
          <div className="flex-1 h-px bg-[hsl(var(--border)/0.6)]" />
          <div
            className="h-1 w-1 rounded-full shrink-0"
            style={{ backgroundColor: `hsl(${glow} / 0.4)` }}
          />
          <div className="flex-1 h-px bg-[hsl(var(--border)/0.6)]" />
        </div>

        {/* Description */}
        <div className="capability-stagger-2 mb-8">
          <p className="text-[13px] leading-relaxed text-[hsl(var(--muted-foreground)/0.75)] max-w-[260px] mx-auto">
            {t(`capabilityCenter.emptyState.${config.id}.description` as string)}
          </p>
        </div>

        {/* CTA */}
        {(onCreate || onAICreate) && (
          <div className="capability-stagger-3 flex items-center justify-center gap-3">
            {onAICreate && (
              <button
                type="button"
                onClick={onAICreate}
                className="
                  inline-flex items-center gap-1.5 px-5 py-2.5
                  rounded-xl text-[13px] font-medium
                  bg-violet-500/10 text-violet-600 border border-violet-500/20
                  shadow-sm hover:shadow-md
                  hover:bg-violet-500/15
                  transition-all duration-200
                  outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2
                "
              >
                <Sparkles className="h-4 w-4" />
                {t('capabilityCreator.aiCreate')}
              </button>
            )}
            {onCreate && (
              <button
                type="button"
                onClick={onCreate}
                className="
                  inline-flex items-center gap-1.5 px-5 py-2.5
                  rounded-xl text-[13px] font-medium
                  bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]
                  shadow-sm hover:shadow-md
                  hover:brightness-110 active:brightness-95
                  transition-all duration-200
                  outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2
                "
              >
                <Plus className="h-4 w-4" />
                {t(`capabilityCenter.emptyState.${config.id}.cta` as string)}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
