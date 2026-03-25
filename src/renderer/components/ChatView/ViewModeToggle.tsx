// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { MessageSquare, FolderCode } from 'lucide-react'
import { useAppStore, selectProjectId, selectProjectPath } from '@/stores/appStore'
import { useGitStore } from '@/stores/gitStore'
import { selectGitSnapshot } from '@/hooks/useGitStatus'
import { cn } from '@/lib/utils'

// ════════════════════════════════════════════════════════════════════
// ViewModeToggle — Pill-shaped toggle for Chat view modes.
//
// Two modes: "default" (conversation) and "files" (files + chat split).
// Parent is responsible for positioning & container styling via `className`.
//
// Only rendered when a project is selected since FilesView requires
// a project context.
// ════════════════════════════════════════════════════════════════════

export function ViewModeToggle({ className }: { className?: string }): React.JSX.Element | null {
  const { t } = useTranslation('navigation')
  const mode = useAppStore((s) => s.chatViewMode)
  const setMode = useAppStore((s) => s.setChatViewMode)
  const hasProject = useAppStore(selectProjectId) !== null
  const projectPath = useAppStore(selectProjectPath)
  const changedCount = useGitStore(
    (s) => selectGitSnapshot(s, projectPath)?.changedCount ?? 0,
  )

  // No toggle needed when viewing "All Projects" — FilesView requires a project context.
  if (!hasProject) return null

  return (
    <div
      className={cn('flex items-center gap-0.5 p-0.5', className)}
      role="radiogroup"
      aria-label={t('chatViewMode.label')}
    >
      <ToggleButton
        icon={<MessageSquare className="w-3 h-3" />}
        label={t('chatViewMode.default')}
        active={mode === 'default'}
        onClick={() => setMode('default')}
      />
      <ToggleButton
        icon={<FolderCode className="w-3 h-3" />}
        label={t('chatViewMode.files')}
        active={mode === 'files'}
        onClick={() => setMode('files')}
        badge={changedCount}
      />
    </div>
  )
}

// ── ToggleButton ────────────────────────────────────────────────────

function ToggleButton({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
  /** Numeric badge displayed after the label (hidden when 0 or undefined). */
  badge?: number
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={badge ? `${label} (${badge})` : label}
      title={badge ? `${label} (${badge})` : label}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
        active
          ? 'bg-[hsl(var(--background))] text-[hsl(var(--foreground))] shadow-sm'
          : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]',
      )}
    >
      {icon}
      <span className="select-none">{label}</span>
      {badge != null && badge > 0 && (
        <span className="min-w-[16px] h-4 px-1 rounded-full bg-[hsl(var(--git-modified))] text-white text-[10px] font-semibold leading-4 text-center">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}
