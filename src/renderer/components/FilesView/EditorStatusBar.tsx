// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { GitBranch } from 'lucide-react'
import { useFileStore } from '@/stores/fileStore'
import { useGitStore } from '@/stores/gitStore'
import { cn } from '@/lib/utils'
import { getFileDecoration } from '@/lib/gitDecorations'
import { selectGitSnapshot } from '@/hooks/useGitStatus'
import type { GitRepositorySnapshot } from '@shared/gitTypes'

interface EditorStatusBarProps {
  projectPath: string
}

/** Branch + sync status indicator — extracted to avoid duplication. */
function BranchIndicator({ snapshot }: { snapshot: GitRepositorySnapshot | undefined }): React.JSX.Element | null {
  const { t } = useTranslation('files')

  if (!snapshot) return null

  return (
    <>
      {snapshot.branch && (
        <span className="flex items-center gap-1 shrink-0">
          <GitBranch className="h-3 w-3" />
          <span className="font-mono">{snapshot.isDetached ? `(${snapshot.branch})` : snapshot.branch}</span>
          {(snapshot.ahead > 0 || snapshot.behind > 0) && (
            <span className="text-[10px]">
              {snapshot.ahead > 0 && `↑${snapshot.ahead}`}
              {snapshot.behind > 0 && `↓${snapshot.behind}`}
            </span>
          )}
        </span>
      )}
      {snapshot.isMerging && <span className="text-git-conflict shrink-0">{t('editor.merging', 'MERGING')}</span>}
      {snapshot.isRebasing && <span className="text-git-conflict shrink-0">{t('editor.rebasing', 'REBASING')}</span>}
    </>
  )
}

export function EditorStatusBar({ projectPath }: EditorStatusBarProps): React.JSX.Element {
  const { t } = useTranslation('files')
  const openFiles = useFileStore((s) => s.openFiles)
  const activeFilePath = useFileStore((s) => s.activeFilePath)
  const gitSnapshot = useGitStore((s) => selectGitSnapshot(s, projectPath))

  const activeFile = openFiles.find((f) => f.path === activeFilePath)

  if (!activeFile) {
    return (
      <div className="h-6 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.2)] flex items-center px-3 text-[11px] text-[hsl(var(--muted-foreground))] gap-4">
        <BranchIndicator snapshot={gitSnapshot} />
      </div>
    )
  }

  const decoration = getFileDecoration(gitSnapshot, activeFile.path)

  return (
    <div className="h-6 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.2)] flex items-center px-3 text-[11px] text-[hsl(var(--muted-foreground))] gap-4">
      <BranchIndicator snapshot={gitSnapshot} />
      {/* File path */}
      <span className="font-mono truncate">{activeFile.path}</span>
      {/* Git status badge for active file */}
      {decoration.tooltip && (
        <span className={cn('shrink-0', decoration.colorClass)}>{decoration.tooltip}</span>
      )}
      <span className="ml-auto shrink-0">{activeFile.language}</span>
      {activeFile.viewKind === 'text' && activeFile.isDirty && <span className="shrink-0">{t('editor.modified')}</span>}
      {/* Changed files count */}
      {gitSnapshot && gitSnapshot.changedCount > 0 && (
        <span className="shrink-0 text-git-modified">
          {t('editor.changedCount', { count: gitSnapshot.changedCount, defaultValue: '{{count}} changed' })}
        </span>
      )}
    </div>
  )
}
