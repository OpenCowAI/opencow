// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog } from '../ui/Dialog'
import { getAppAPI } from '@/windowAPI'
import type { DiscoveredProjectCandidate } from '@shared/types'

type Phase = 'discovering' | 'ready' | 'importing'

interface ImportProjectsDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * Modal dialog listing discovered-but-unimported Claude Code projects.
 *
 * Users can select which projects to import via checkboxes, then click
 * "Import" to batch-import them.  The dialog fetches candidates on open
 * and resets state on close.
 */
export function ImportProjectsDialog({
  open,
  onClose,
}: ImportProjectsDialogProps): React.JSX.Element | null {
  const { t } = useTranslation('navigation')
  const [candidates, setCandidates] = useState<DiscoveredProjectCandidate[]>([])
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set())
  const [phase, setPhase] = useState<Phase>('discovering')
  const mountedRef = useRef(true)

  // Fetch candidates when dialog opens; reset when closed
  useEffect(() => {
    if (!open) return
    mountedRef.current = true
    setPhase('discovering')
    setCandidates([])
    setSelectedFolders(new Set())

    getAppAPI()['discover-importable-projects']()
      .then((projects) => {
        if (!mountedRef.current) return
        setCandidates(projects)
        setSelectedFolders(new Set(projects.map((p) => p.folderName)))
        setPhase('ready')
      })
      .catch(() => {
        if (!mountedRef.current) return
        setPhase('ready')
      })

    return () => { mountedRef.current = false }
  }, [open])

  const toggleFolder = useCallback((folderName: string) => {
    setSelectedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folderName)) next.delete(folderName)
      else next.add(folderName)
      return next
    })
  }, [])

  const toggleAll = useCallback((checked: boolean) => {
    if (checked) {
      setSelectedFolders(new Set(candidates.map((c) => c.folderName)))
    } else {
      setSelectedFolders(new Set())
    }
  }, [candidates])

  const handleImport = useCallback(async () => {
    if (selectedFolders.size === 0) {
      onClose()
      return
    }
    setPhase('importing')
    try {
      const selected = candidates.filter((c) => selectedFolders.has(c.folderName))
      await getAppAPI()['import-discovered-projects'](selected)
    } catch {
      // Import failed — close anyway; user can retry later
    }
    onClose()
  }, [selectedFolders, candidates, onClose])

  const allSelected = candidates.length > 0 && selectedFolders.size === candidates.length
  const someSelected = selectedFolders.size > 0 && selectedFolders.size < candidates.length

  return (
    <Dialog open={open} onClose={onClose} title={t('importDialog.title', 'Import Projects')} size="sm">
      <div className="p-6">
        {/* Header */}
        <h2 className="text-base font-semibold mb-1">
          {t('importDialog.title', 'Import Projects')}
        </h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">
          {t('importDialog.description', 'Select which Claude Code projects to import.')}
        </p>

        {/* Content area */}
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] px-4 py-3 mb-5">
          {phase === 'discovering' ? (
            <div className="flex items-center justify-center py-6 gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--primary))]" aria-hidden="true" />
              <span className="text-sm text-[hsl(var(--muted-foreground))]">
                {t('addProject.scanning', 'Scanning…')}
              </span>
            </div>
          ) : candidates.length === 0 ? (
            <div className="text-center py-6">
              <FolderOpen className="h-7 w-7 mx-auto mb-2 text-[hsl(var(--muted-foreground)/0.4)]" aria-hidden="true" />
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                {t('addProject.emptyState', 'All projects already imported')}
              </p>
            </div>
          ) : (
            <>
              {/* Select All header */}
              <div className="flex items-center justify-between mb-2 pb-2 border-b border-[hsl(var(--border))]">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected }}
                    onChange={(e) => toggleAll(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-[hsl(var(--border))] accent-[hsl(var(--primary))]"
                  />
                  <span className="text-xs font-medium">
                    {t('importDialog.selectAll', 'Select All')} ({candidates.length})
                  </span>
                </label>
                <span className="text-[10px] text-[hsl(var(--muted-foreground))] tabular-nums">
                  {selectedFolders.size} {t('importDialog.selected', 'selected')}
                </span>
              </div>

              {/* Project list */}
              <div className="space-y-0.5 max-h-[240px] overflow-y-auto overscroll-contain -mx-1 px-1">
                {candidates.map((candidate) => (
                  <label
                    key={candidate.folderName}
                    className={cn(
                      'flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition-colors',
                      'hover:bg-[hsl(var(--accent)/0.5)]',
                      selectedFolders.has(candidate.folderName) && 'bg-[hsl(var(--accent)/0.3)]',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selectedFolders.has(candidate.folderName)}
                      onChange={() => toggleFolder(candidate.folderName)}
                      className="h-3.5 w-3.5 shrink-0 rounded border-[hsl(var(--border))] accent-[hsl(var(--primary))]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{candidate.name}</p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">
                        {candidate.resolvedPath}
                      </p>
                    </div>
                    <span className="text-[10px] text-[hsl(var(--muted-foreground))] shrink-0 tabular-nums">
                      {candidate.sessionCount}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={phase === 'importing'}
            className="px-3 py-1.5 text-sm rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors disabled:opacity-50"
          >
            {t('importDialog.cancel', 'Cancel')}
          </button>
          <button
            onClick={() => void handleImport()}
            disabled={phase === 'importing' || phase === 'discovering' || selectedFolders.size === 0}
            className="px-4 py-1.5 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {phase === 'importing' ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                {t('importDialog.importing', 'Importing…')}
              </span>
            ) : (
              t('importDialog.import', { count: selectedFolders.size })
            )}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
