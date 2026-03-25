// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'

interface CategorySectionProps {
  id: string
  title: string
  icon: React.ComponentType<{ className?: string }>
  count: number
  onCreate?: () => void
  children: React.ReactNode
}

export function CategorySection({
  id,
  title,
  icon: Icon,
  count,
  onCreate,
  children,
}: CategorySectionProps): React.JSX.Element | null {
  const { t } = useTranslation('sessions')

  // Non-creatable categories with 0 items: hide entirely
  if (count === 0 && !onCreate) return null

  return (
    <section id={id} aria-label={t('capabilities.categoryAria', { title, count })}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
        <span className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          {title}
        </span>
        <span className="text-[10px] tabular-nums text-[hsl(var(--muted-foreground))]">
          ({count})
        </span>
        {onCreate && (
          <button
            type="button"
            onClick={onCreate}
            aria-label={t('capabilities.createCategory', { title })}
            className="ml-auto p-0.5 rounded-md hover:bg-[hsl(var(--foreground)/0.04)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          >
            <Plus className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          </button>
        )}
      </div>

      {children}
    </section>
  )
}
