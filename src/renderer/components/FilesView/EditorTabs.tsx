// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useFileStore } from '@/stores/fileStore'
import { useGitStore } from '@/stores/gitStore'
import { cn } from '@/lib/utils'
import { getFileDecoration } from '@/lib/gitDecorations'
import { selectGitSnapshot } from '@/hooks/useGitStatus'

interface EditorTabsProps {
  projectPath: string
}

export function EditorTabs({ projectPath }: EditorTabsProps): React.JSX.Element {
  const { t } = useTranslation('files')
  const openFiles = useFileStore((s) => s.openFiles)
  const activeFilePath = useFileStore((s) => s.activeFilePath)
  const setActiveFile = useFileStore((s) => s.setActiveFile)
  const closeFile = useFileStore((s) => s.closeFile)
  const gitSnapshot = useGitStore((s) => selectGitSnapshot(s, projectPath))

  if (openFiles.length === 0) return <div className="h-9 border-b border-[hsl(var(--border))]" />

  return (
    <div
      className="flex items-center h-9 border-b border-[hsl(var(--border))] overflow-x-auto bg-[hsl(var(--muted)/0.2)]"
      role="tablist"
      aria-label={t('editor.openFilesAria')}
    >
      {openFiles.map((file) => {
        const isActive = file.path === activeFilePath
        const decoration = getFileDecoration(gitSnapshot, file.path)
        return (
          <div
            key={file.path}
            role="tab"
            aria-selected={isActive}
            tabIndex={0}
            className={cn(
              'flex items-center gap-1.5 px-3 h-full text-[13px] cursor-pointer select-none shrink-0',
              'border-r border-[hsl(var(--border)/0.5)] transition-colors',
              isActive
                ? 'bg-[hsl(var(--background))] text-[hsl(var(--foreground))]'
                : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)]'
            )}
            onClick={() => setActiveFile(file.path)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setActiveFile(file.path)
            }}
            title={decoration.tooltip ?? undefined}
          >
            {file.isDirty && (
              <span className="w-2 h-2 rounded-full bg-[hsl(var(--foreground))] shrink-0" aria-label={t('editor.unsavedChanges')} />
            )}
            <span className={cn('truncate max-w-[160px]', decoration.colorClass)}>{file.name}</span>
            {decoration.badge && (
              <span className={cn('text-[10px] font-mono shrink-0', decoration.colorClass)}>
                {decoration.badge}
              </span>
            )}
            <button
              className="p-0.5 rounded hover:bg-[hsl(var(--foreground)/0.04)] transition-colors shrink-0"
              onClick={(e) => {
                e.stopPropagation()
                closeFile(file.path)
              }}
              aria-label={t('editor.closeFile', { name: file.name })}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
