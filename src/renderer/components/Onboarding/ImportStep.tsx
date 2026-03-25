// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getAppAPI } from '@/windowAPI'
import type { DiscoveredProjectCandidate } from '@shared/types'
import { StepIndicator } from './StepIndicator'
import type { StepConfig } from './types'

type Phase = 'discovering' | 'ready' | 'importing'

interface ImportStepProps {
  stepConfig: StepConfig
  onComplete: () => void
}

export function ImportStep({
  stepConfig,
  onComplete,
}: ImportStepProps): React.JSX.Element {
  const { t } = useTranslation('onboarding')
  const [candidates, setCandidates] = useState<DiscoveredProjectCandidate[]>([])
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set())
  const [phase, setPhase] = useState<Phase>('discovering')
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    getAppAPI()['discover-importable-projects']()
      .then((projects) => {
        if (!mountedRef.current) return
        setCandidates(projects)
        setSelectedFolders(new Set(projects.map((p) => p.folderName)))
        setPhase('ready')
      })
      .catch(() => {
        if (!mountedRef.current) return
        setPhase('ready') // Show empty state on error
      })
    return () => { mountedRef.current = false }
  }, [])

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
      onComplete()
      return
    }

    setPhase('importing')
    try {
      const selected = candidates.filter((c) => selectedFolders.has(c.folderName))
      await getAppAPI()['import-discovered-projects'](selected)
    } catch {
      // Import failed — proceed anyway; user can add projects manually later
    }
    onComplete()
  }, [selectedFolders, candidates, onComplete])

  const allSelected = candidates.length > 0 && selectedFolders.size === candidates.length
  const someSelected = selectedFolders.size > 0 && selectedFolders.size < candidates.length

  return (
    <div className="onboarding-step-enter">
      <StepIndicator {...stepConfig} />

      <div className="text-center mb-6">
        <h2 className="text-xl font-bold mb-1.5">{t('import.title')}</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {t('import.subtitle')}
        </p>
      </div>

      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-5 py-4 mb-6">
        {phase === 'discovering' ? (
          <div className="flex items-center justify-center py-8 gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--primary))]" />
            <span className="text-sm text-[hsl(var(--muted-foreground))]">
              {t('import.scanning')}
            </span>
          </div>
        ) : candidates.length === 0 ? (
          <div className="text-center py-8">
            <FolderOpen className="h-8 w-8 mx-auto mb-3 text-[hsl(var(--muted-foreground)/0.4)]" />
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {t('import.noProjects')}
            </p>
            <p className="text-xs text-[hsl(var(--muted-foreground)/0.7)] mt-1">
              {t('import.addLater')}
            </p>
          </div>
        ) : (
          <>
            {/* Select All header */}
            <div className="flex items-center justify-between mb-3 pb-3 border-b border-[hsl(var(--border))]">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected
                  }}
                  onChange={(e) => toggleAll(e.target.checked)}
                  className="h-4 w-4 rounded border-[hsl(var(--border))] accent-[hsl(var(--primary))]"
                />
                <span className="text-sm font-medium">
                  {t('import.selectAll', { count: candidates.length })}
                </span>
              </label>
              <span className="text-xs text-[hsl(var(--muted-foreground))]">
                {t('import.selectedCount', { count: selectedFolders.size })}
              </span>
            </div>

            {/* Project list */}
            <div className="space-y-0.5 max-h-[280px] overflow-y-auto -mx-1 px-1">
              {candidates.map((candidate) => (
                <label
                  key={candidate.folderName}
                  className={cn(
                    'flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors',
                    'hover:bg-[hsl(var(--accent)/0.5)]',
                    selectedFolders.has(candidate.folderName) && 'bg-[hsl(var(--accent)/0.3)]'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selectedFolders.has(candidate.folderName)}
                    onChange={() => toggleFolder(candidate.folderName)}
                    className="h-4 w-4 shrink-0 rounded border-[hsl(var(--border))] accent-[hsl(var(--primary))]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{candidate.name}</p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">
                      {candidate.resolvedPath}
                    </p>
                  </div>
                  <span className="text-xs text-[hsl(var(--muted-foreground))] shrink-0 tabular-nums">
                    {t('import.session', { count: candidate.sessionCount })}
                  </span>
                </label>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={onComplete}
          disabled={phase === 'importing'}
          className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors disabled:opacity-50"
          aria-label={t('common.skip')}
        >
          {t('common.skip')}
        </button>
        <button
          onClick={() => void handleImport()}
          disabled={phase === 'importing' || phase === 'discovering'}
          className="px-5 py-2.5 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          aria-label={
            selectedFolders.size > 0
              ? t('import.importProject', { count: selectedFolders.size })
              : t('common.continue')
          }
        >
          {phase === 'importing' ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('import.importing')}
            </span>
          ) : selectedFolders.size > 0 ? (
            t('import.importProject', { count: selectedFolders.size })
          ) : (
            t('common.continue')
          )}
        </button>
      </div>
    </div>
  )
}
