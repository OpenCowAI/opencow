// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useMemoryStore } from '@/stores/memoryStore'
import { useAppStore } from '@/stores/appStore'
import { ProjectPicker } from '@/components/ui/ProjectPicker'
import { useExitAnimation } from '@/hooks/useModalAnimation'
import { cn } from '@/lib/utils'
import { CategoryPillMenu } from './CategoryPillMenu'

interface MemoryCreateModalProps {
  onClose: () => void
}

export function MemoryCreateModal({ onClose }: MemoryCreateModalProps): React.JSX.Element {
  const { t } = useTranslation('memory')
  const { phase, requestClose } = useExitAnimation(onClose)
  const dialogRef = useRef<HTMLDivElement>(null)

  const createMemory = useMemoryStore((s) => s.createMemory)
  const draft = useMemoryStore((s) => s.draft)
  const updateDraft = useMemoryStore((s) => s.updateDraft)
  const clearDraft = useMemoryStore((s) => s.clearDraft)

  const [submitting, setSubmitting] = useState(false)

  // Seed draft.projectId from active project on first open (only if draft is pristine)
  const activeProjectId = useAppStore((s) =>
    s.appView.mode === 'projects' ? s.appView.projectId : null,
  )
  useEffect(() => {
    if (!draft.content && draft.projectId === null && activeProjectId) {
      updateDraft({ projectId: activeProjectId })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { dialogRef.current?.focus() }, [])

  const canSubmit = draft.content.trim().length > 0 && !submitting

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await createMemory({
        scope: draft.projectId ? 'project' : 'user',
        projectId: draft.projectId ?? undefined,
        content: draft.content.trim(),
        category: draft.category,
        source: 'user_explicit',
      })
      clearDraft()
      requestClose()
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, draft, createMemory, clearDraft, requestClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') requestClose()
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void handleSubmit()
    }
  }, [requestClose, handleSubmit])

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center overscroll-contain no-drag outline-none"
      role="dialog"
      aria-modal="true"
      aria-label={t('create.title')}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div
        className={cn(
          'absolute inset-0 bg-black/50',
          phase === 'enter' && 'modal-overlay-enter',
          phase === 'exit' && 'modal-overlay-exit',
        )}
        onClick={requestClose}
        aria-hidden="true"
      />

      <div
        className={cn(
          'relative z-10 bg-[hsl(var(--background))] border border-[hsl(var(--border))]',
          'rounded-2xl shadow-lg w-full max-w-[520px] mx-4',
          'flex flex-col min-h-[480px] max-h-[calc(100vh-2rem)] overflow-hidden',
          phase === 'enter' && 'modal-content-enter',
          phase === 'exit' && 'modal-content-exit',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-1.5 min-w-0">
            <ProjectPicker
              value={draft.projectId}
              onChange={(pid) => updateDraft({ projectId: pid })}
              placeholder={t('create.scopeUser')}
              ariaLabel={t('create.scopeLabel')}
              triggerClassName="rounded-full py-1 px-2.5 text-xs"
              position="below"
            />
            <span className="text-[hsl(var(--muted-foreground))] text-xs shrink-0">&rsaquo;</span>
            <span className="text-sm text-[hsl(var(--foreground))] font-medium truncate">
              {t('create.title')}
            </span>
          </div>
          <button
            onClick={requestClose}
            className="p-1 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors shrink-0"
            aria-label={t('create.cancel')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col px-5 py-4 overflow-y-auto min-h-0">
          <textarea
            value={draft.content}
            onChange={(e) => updateDraft({ content: e.target.value })}
            placeholder={t('create.contentPlaceholder')}
            className="w-full flex-1 min-h-[200px] text-sm bg-transparent border-none outline-none resize-none placeholder:text-[hsl(var(--muted-foreground))] text-[hsl(var(--foreground))]"
            autoFocus
            aria-label={t('create.contentLabel')}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-[hsl(var(--border))]">
          <CategoryPillMenu
            value={draft.category}
            onChange={(cat) => { if (cat) updateDraft({ category: cat }) }}
          />

          <div className="flex-1" />

          <button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className={cn(
              'px-4 py-1.5 text-xs font-medium rounded-lg transition-opacity',
              'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
              canSubmit ? 'hover:opacity-90' : 'opacity-50',
            )}
          >
            {submitting ? t('create.submitting') : t('create.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
