// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { Archive, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CATEGORY_ICON_MAP } from './memoryCategoryConfig'
import { useAppStore } from '@/stores/appStore'
import type { MemoryItem } from '@shared/types'

interface MemoryCardProps {
  memory: MemoryItem
  selected: boolean
  onToggleSelect: () => void
  onClick: () => void
  onDelete: () => void
  onArchive: () => void
}


export function MemoryCard({
  memory,
  selected,
  onToggleSelect,
  onClick,
  onDelete,
  onArchive,
}: MemoryCardProps): React.JSX.Element {
  const { t } = useTranslation('memory')
  const projectName = useAppStore((s) =>
    memory.scope === 'project' && memory.projectId
      ? s.projects.find((p) => p.id === memory.projectId)?.name ?? null
      : null,
  )
  const scopeLabel = projectName
    ? `${t('scopeProject')} · ${projectName}`
    : memory.scope === 'project' ? t('scopeProject') : t('scopeUser')
  const categoryLabel = t(`category.${memory.category}`)
  const date = new Date(memory.updatedAt)
  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  return (
    <div
      className={cn(
        'group flex items-start gap-3 -mx-1.5 px-3 py-2.5 rounded-lg transition-colors cursor-pointer',
        selected
          ? 'bg-[hsl(var(--primary)/0.06)]'
          : 'hover:bg-[hsl(var(--foreground)/0.03)]',
      )}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={categoryLabel}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={selected}
        onChange={(e) => { e.stopPropagation(); onToggleSelect() }}
        onClick={(e) => e.stopPropagation()}
        className="mt-1 shrink-0 rounded border-[hsl(var(--border))]"
        aria-label={t('select')}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[hsl(var(--foreground))] line-clamp-2">{memory.content}</p>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
            {(() => { const Icon = CATEGORY_ICON_MAP.get(memory.category); return Icon ? <Icon className="w-2.5 h-2.5" aria-hidden="true" /> : null })()}
            {categoryLabel}
          </span>
          <span className="text-[10px] text-[hsl(var(--muted-foreground))]">{scopeLabel}</span>
          <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.5)]">{dateStr}</span>
          <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.5)]">{Math.round(memory.confidence * 100)}%</span>
          {memory.accessCount > 0 && (
            <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.5)]">
              {t('usedCount', { count: memory.accessCount })}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onArchive() }}
          className="p-1 rounded hover:bg-[hsl(var(--foreground)/0.05)] focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] transition-colors outline-none"
          aria-label={t('archive')}
        >
          <Archive className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="p-1 rounded hover:bg-red-500/10 focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] transition-colors outline-none"
          aria-label={t('delete')}
        >
          <Trash2 className="h-3.5 w-3.5 text-red-500/70" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
