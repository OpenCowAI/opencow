// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Sparkles } from 'lucide-react'
import { useDroppable } from '@dnd-kit/core'
import { useAppStore, selectProjectId } from '../../stores/appStore'
import { useIssueStore, selectIssuesArray } from '../../stores/issueStore'
import { useNoteStore } from '../../stores/noteStore'
import { cn } from '../../lib/utils'
import { UNPARENT_DROPPABLE_ID } from '../../constants/droppableIds'
import { useIssueShortcuts } from '../../hooks/useIssueShortcuts'
import { IssueFormModal } from '../IssueForm/IssueFormModal'
import { IssueAICreatorModal } from '../IssueAICreator'
import { IssueDndProvider, useIssueDndContext } from './IssueDndProvider'
import { ViewTabBar } from './ViewTabBar'
import { EphemeralFilterBar } from './EphemeralFilterBar'
import { DisplayControlBar } from './DisplayControlBar'
import { ProviderQuickSwitcher } from './ProviderQuickSwitcher'
import { IssueGroupedList } from './IssueGroupedList'

export function IssuesView(): React.JSX.Element {
  const { t } = useTranslation('issues')
  const issues = useIssueStore(selectIssuesArray)
  const loadIssues = useIssueStore((s) => s.loadIssues)
  const loadNoteCountsByIssue = useNoteStore((s) => s.loadNoteCountsByIssue)
  const sidebarProjectId = useAppStore(selectProjectId)

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showAICreator, setShowAICreator] = useState(false)

  // Keyboard shortcuts (e.g. Cmd+N to create issue)
  const openCreateModal = useCallback(() => setShowCreateModal(true), [])
  useIssueShortcuts({ onCreateIssue: openCreateModal })

  // Load issues on mount and whenever project scope changes.
  // A single effect avoids duplicate mount fetches.
  useEffect(() => {
    loadIssues()
  }, [loadIssues, sidebarProjectId])

  // Load note counts for badge display in the issue list
  useEffect(() => {
    loadNoteCountsByIssue()
  }, [loadNoteCountsByIssue])

  return (
    <div className="h-full flex flex-col min-w-0 overflow-hidden">
      {/* View Tab Bar — All + custom views + drag reorder + create */}
      <ViewTabBar />

      {/* Filter + Search + Display controls — single row */}
      <div className="flex-none flex items-center gap-2 px-4 py-2 border-b border-[hsl(var(--border)/0.5)]">
        {/* Left: Filter + Search (flexible) */}
        <div className="flex-1 min-w-0">
          <EphemeralFilterBar />
        </div>

        {/* Right: Group + Sort + Create */}
        <div className="flex-none flex items-center gap-1">
          <DisplayControlBar />

          {/* Provider quick switcher */}
          <ProviderQuickSwitcher />

          {/* Separator */}
          <span className="w-px h-3 bg-[hsl(var(--border)/0.4)]" />

          {/* AI Create issue button */}
          <button
            onClick={() => setShowAICreator(true)}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-violet-500 hover:bg-violet-500/10 transition-colors text-xs font-medium"
            aria-label={t('aiCreator.title')}
          >
            <Sparkles className="w-3.5 h-3.5" aria-hidden />
            <span>AI</span>
          </button>

          {/* Create issue button */}
          <button
            onClick={() => setShowCreateModal(true)}
            className="p-1 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
            aria-label={t('createNewIssue')}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Issue list — wrapped in DnD provider for drag-to-parent functionality */}
      <IssueDndProvider issues={issues}>
        <UnparentDropZone />
        <IssueGroupedList />
      </IssueDndProvider>

      {/* Create modal */}
      {showCreateModal && (
        <IssueFormModal
          defaultProjectId={sidebarProjectId}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {/* AI Issue Creator modal */}
      <IssueAICreatorModal
        open={showAICreator}
        onClose={() => setShowAICreator(false)}
      />
    </div>
  )
}

/**
 * Drop zone that appears at the top of the list when dragging a child issue.
 * Dropping here removes the issue from its parent (sets parentIssueId to null).
 */
function UnparentDropZone(): React.JSX.Element | null {
  const { t } = useTranslation('issues')
  const { activeIssue } = useIssueDndContext()
  const { setNodeRef, isOver } = useDroppable({ id: UNPARENT_DROPPABLE_ID })

  // Only show when dragging a child issue (one that has a parent)
  if (!activeIssue?.parentIssueId) return null

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'mx-4 mt-2 mb-1 px-4 py-3 rounded-lg border-2 border-dashed',
        'text-center text-xs transition-colors',
        isOver
          ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--primary))]'
          : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]'
      )}
      aria-label={t('dropToRemoveParent')}
    >
      {t('dropToRemoveParent')}
    </div>
  )
}
