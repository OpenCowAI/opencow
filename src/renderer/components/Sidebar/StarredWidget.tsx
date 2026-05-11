// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { Star } from 'lucide-react'
import { useAppStore } from '@/stores/appStore'
import { cn } from '@/lib/utils'

/**
 * Sidebar entry for the globally-scoped "Starred Artifacts" view.
 *
 * Mirrors `InboxWidget`'s collapsed / expanded affordances; clicking
 * routes to `{ mode: 'projects', tab: 'starred', projectId: null }` via
 * `navigateToStarred()`. Active highlight fires only in that exact
 * combination — the per-project starred tab (if reached via the
 * MorePopover within a project) is a different surface and shouldn't
 * also light up this sidebar entry.
 */
export function StarredWidget({ collapsed = false }: { collapsed?: boolean }): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const appView = useAppStore((s) => s.appView)
  const navigateToStarred = useAppStore((s) => s.navigateToStarred)

  const isActive =
    appView.mode === 'projects' &&
    appView.tab === 'starred' &&
    appView.projectId === null

  if (collapsed) {
    return (
      <button
        onClick={() => navigateToStarred()}
        className={cn(
          'no-drag relative w-full flex flex-col items-center justify-center gap-1 py-2 rounded-md transition-colors',
          'hover:bg-[hsl(var(--sidebar-primary)/0.08)]',
          isActive
            ? 'text-[hsl(var(--sidebar-foreground))]'
            : 'text-[hsl(var(--sidebar-foreground)/0.86)] hover:text-[hsl(var(--sidebar-foreground))]',
        )}
        aria-label={t('mainTabs.starredArtifacts')}
      >
        <Star
          className={cn('h-4 w-4 shrink-0', isActive && 'fill-current')}
          aria-hidden="true"
        />
        <span className="text-[10px] leading-none">
          {t('mainTabs.starredArtifacts')}
        </span>
      </button>
    )
  }

  return (
    <button
      onClick={() => navigateToStarred()}
      className="group w-full flex items-center px-1 py-0.5 text-sm transition-colors"
      aria-label={t('mainTabs.starredArtifacts')}
    >
      <span
        className={cn(
          'inline-flex items-center gap-2 rounded-full px-2.5 py-1.5 transition-colors min-w-0',
          'group-hover:bg-[hsl(var(--sidebar-primary)/0.05)]',
          isActive && 'font-bold',
        )}
      >
        <Star
          className={cn('h-4 w-4 shrink-0', isActive && 'fill-current')}
          aria-hidden="true"
        />
        <span className="truncate">{t('mainTabs.starredArtifacts')}</span>
      </span>
    </button>
  )
}
