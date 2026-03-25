// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { CATEGORY_REGISTRY, groupedCategories } from './categoryRegistry'

// Re-export for backward compatibility
export { CATEGORY_REGISTRY as CATEGORIES } from './categoryRegistry'

// === Side Navigation ===

interface CapabilitySideNavProps {
  counts: Record<string, number>
  activeId: string
  onNavigate: (id: string) => void
}

export function CapabilitySideNav({
  counts,
  activeId,
  onNavigate,
}: CapabilitySideNavProps): React.JSX.Element {
  const { t } = useTranslation('sessions')

  return (
    <nav
      className="flex-1 overflow-y-auto px-3 pb-3 space-y-3"
      aria-label={t('capabilities.categoriesAria')}
    >
      {groupedCategories().map(({ group, categories }) => {
        // Managed categories always visible; legacy only when they have data
        const visibleCats = categories.filter(
          (c) => c.managed || counts[c.id] > 0,
        )
        // Entire group hidden when no visible categories
        if (visibleCats.length === 0) return null

        return (
          <div key={group.id} className="space-y-0.5">
            {/* Group header — ultra-minimal, Linear style */}
            <div className="px-3 pt-1 pb-0.5">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground)/0.45)]">
                {t(`capabilityCenter.categoryGroups.${group.titleKey}`)}
              </span>
            </div>

            {/* Category buttons */}
            {visibleCats.map((cat) => {
              const Icon = cat.icon
              const isActive = activeId === cat.id
              const count = counts[cat.id] ?? 0
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => onNavigate(cat.id)}
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                    isActive
                      ? 'bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--accent-foreground))] font-medium'
                      : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
                  )}
                  aria-current={isActive ? 'true' : undefined}
                  aria-label={t('capabilities.categoryNavAria', { title: t(`capabilityCenter.categories.${cat.titleKey}`), count })}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{t(`capabilityCenter.categories.${cat.titleKey}`)}</span>
                  <span className="ml-auto text-[10px] tabular-nums opacity-70">
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        )
      })}
    </nav>
  )
}
