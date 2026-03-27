// SPDX-License-Identifier: Apache-2.0

/**
 * Reusable category selector pill with grouped dropdown.
 * Used in MemoryCreateModal, MemoryDetailView, and MemoryView filter.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { PillDropdown, PILL_TRIGGER } from '@/components/ui/PillDropdown'
import { CATEGORY_GROUPS, CATEGORY_ICON_MAP } from './memoryCategoryConfig'
import { cn } from '@/lib/utils'
import type { MemoryCategory } from '@shared/types'

interface CategoryPillMenuProps {
  value: MemoryCategory | null
  onChange: (category: MemoryCategory | null) => void
  /** Show "All Categories" as first option. Default: false. */
  showAll?: boolean
  /** PillDropdown position. Default: 'above'. */
  position?: 'above' | 'below'
}

export function CategoryPillMenu({
  value,
  onChange,
  showAll = false,
  position = 'above',
}: CategoryPillMenuProps): React.JSX.Element {
  const { t } = useTranslation('memory')
  const [open, setOpen] = useState(false)

  const ActiveIcon = value ? CATEGORY_ICON_MAP.get(value) : null

  return (
    <PillDropdown
      open={open}
      onOpenChange={setOpen}
      position={position}
      trigger={
        <button
          onClick={() => setOpen((prev) => !prev)}
          className={PILL_TRIGGER}
          aria-label={t('create.categoryLabel')}
        >
          {ActiveIcon && <ActiveIcon className="w-3.5 h-3.5" aria-hidden="true" />}
          {value ? t(`category.${value}`) : t('categoryAll')}
        </button>
      }
    >
      {/* "All" option (optional) */}
      {showAll && (
        <button
          onClick={() => { onChange(null); setOpen(false) }}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
            !value ? 'bg-[hsl(var(--primary)/0.08)]' : 'hover:bg-[hsl(var(--foreground)/0.04)]',
          )}
        >
          <span className="flex-1">{t('categoryAll')}</span>
          {!value && <Check className="w-3 h-3 shrink-0 text-[hsl(var(--primary))]" />}
        </button>
      )}

      {/* Grouped categories */}
      {CATEGORY_GROUPS.map((group, gi) => (
        <div key={group.key}>
          {(gi > 0 || showAll) && <div className="my-1 h-px bg-[hsl(var(--border))]" role="separator" />}
          <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground)/0.6)]">
            {t(`categoryGroup.${group.key}`)}
          </div>
          {group.categories.map(({ key: cat, icon: Icon }) => (
            <button
              key={cat}
              onClick={() => { onChange(cat); setOpen(false) }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors',
                value === cat
                  ? 'bg-[hsl(var(--primary)/0.08)]'
                  : 'hover:bg-[hsl(var(--foreground)/0.04)]',
              )}
            >
              <Icon className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
              <span className="text-xs text-[hsl(var(--foreground))]">{t(`category.${cat}`)}</span>
              <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.6)] truncate">{t(`categoryDesc.${cat}`)}</span>
              {value === cat && <Check className="w-3 h-3 shrink-0 text-[hsl(var(--primary))]" />}
            </button>
          ))}
        </div>
      ))}
    </PillDropdown>
  )
}
