// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Brain, Plus, Search, Archive, Trash2, X } from 'lucide-react'
import { useAppStore } from '@/stores/appStore'
import { useMemoryStore } from '@/stores/memoryStore'
import { ProjectPicker } from '@/components/ui/ProjectPicker'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { MemoryCard } from './MemoryCard'
import { MemoryCreateModal } from './MemoryCreateModal'
import { CategoryPillMenu } from './CategoryPillMenu'
import type { MemoryCategory } from '@shared/types'

const SEARCH_DEBOUNCE_MS = 300

export function MemoryView(): React.JSX.Element {
  const { t } = useTranslation('memory')
  const activeProjectId = useAppStore((s) => s.appView.mode === 'projects' ? s.appView.projectId : null)
  const openDetail = useAppStore((s) => s.openDetail)

  const memories = useMemoryStore((s) => s.memories)
  const stats = useMemoryStore((s) => s.stats)
  const categoryFilter = useMemoryStore((s) => s.categoryFilter)
  const loadMemories = useMemoryStore((s) => s.loadMemories)
  const loadStats = useMemoryStore((s) => s.loadStats)
  const searchMemories = useMemoryStore((s) => s.searchMemories)
  const deleteMemory = useMemoryStore((s) => s.deleteMemory)
  const archiveMemory = useMemoryStore((s) => s.archiveMemory)
  const bulkDelete = useMemoryStore((s) => s.bulkDelete)
  const bulkArchive = useMemoryStore((s) => s.bulkArchive)
  const setCategoryFilter = useMemoryStore((s) => s.setCategoryFilter)
  const setSearchQuery = useMemoryStore((s) => s.setSearchQuery)

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [searchInput, setSearchInput] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [filterProjectId, setFilterProjectId] = useState<string | null>(activeProjectId)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load on mount and filter changes
  useEffect(() => {
    setIsLoading(true)
    const params = {
      scope: filterProjectId ? 'project' as const : undefined,
      category: categoryFilter ?? undefined,
      projectId: filterProjectId ?? undefined,
      status: 'confirmed' as const,
      sortBy: 'updated_at' as const,
      sortOrder: 'desc' as const,
      limit: 200,
    }
    Promise.all([
      loadMemories(params),
      loadStats(filterProjectId ?? undefined),
    ]).finally(() => setIsLoading(false))
  }, [filterProjectId, categoryFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search
  const reloadWithFilters = useCallback((query?: string) => {
    if (query?.trim()) {
      void searchMemories(query, {
        scope: filterProjectId ? 'project' : undefined,
        projectId: filterProjectId ?? undefined,
        category: categoryFilter ?? undefined,
      })
    } else {
      setSearchQuery('')
      void loadMemories({
        scope: filterProjectId ? 'project' : undefined,
        category: categoryFilter ?? undefined,
        projectId: filterProjectId ?? undefined,
        status: 'confirmed',
        sortBy: 'updated_at',
        sortOrder: 'desc',
        limit: 200,
      })
    }
  }, [searchMemories, setSearchQuery, loadMemories, filterProjectId, categoryFilter])

  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => reloadWithFilters(value), SEARCH_DEBOUNCE_MS)
  }, [reloadWithFilters])

  // Cleanup search timer
  useEffect(() => () => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
  }, [])

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteConfirmId) return
    await deleteMemory(deleteConfirmId)
    setDeleteConfirmId(null)
  }, [deleteConfirmId, deleteMemory])

  const handleConfirmBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return
    await bulkDelete(Array.from(selectedIds))
    setSelectedIds(new Set())
    setBulkDeleteConfirm(false)
  }, [selectedIds, bulkDelete])

  const handleBulkArchive = useCallback(async () => {
    if (selectedIds.size === 0) return
    await bulkArchive(Array.from(selectedIds))
    setSelectedIds(new Set())
  }, [selectedIds, bulkArchive])


  return (
    <div className="h-full flex flex-col min-w-0 overflow-hidden">
      {/* Header */}
      {/* Header + Filters (single row) */}
      <div className="drag-region border-b border-[hsl(var(--border))] px-4 py-2">
        <div className="flex items-center gap-2 no-drag">
          <Brain className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          <h1 className="text-sm font-semibold text-[hsl(var(--foreground))] shrink-0">{t('title')}</h1>
          {stats && (
            <span className="text-xs text-[hsl(var(--muted-foreground))] shrink-0">
              {t('activeCount', { count: stats.active })}
            </span>
          )}

          {/* Search */}
          <div className="relative flex-1 min-w-[120px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
            <input
              type="text"
              placeholder={t('searchPlaceholder')}
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-[hsl(var(--border))] bg-transparent focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
              aria-label={t('searchPlaceholder')}
            />
          </div>

          {/* Filters */}
          <ProjectPicker
            value={filterProjectId}
            onChange={setFilterProjectId}
            placeholder={t('scopeAll')}
            ariaLabel={t('scopeAll')}
            triggerClassName="rounded-full py-1 px-2.5 text-xs"
            position="below"
          />
          <CategoryPillMenu
            value={categoryFilter}
            onChange={setCategoryFilter}
            showAll
            position="below"
          />

          {/* New Memory */}
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity shrink-0"
            aria-label={t('newMemory')}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t('newMemory')}
          </button>
        </div>
      </div>

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <div className="border-b border-[hsl(var(--border))] px-4 py-2 flex items-center gap-2 bg-[hsl(var(--muted)/0.3)]">
          <span className="text-xs text-[hsl(var(--muted-foreground))]" aria-live="polite">
            {t('selected', { count: selectedIds.size })}
          </span>
          <button
            onClick={() => void handleBulkArchive()}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-md hover:bg-[hsl(var(--foreground)/0.05)] transition-colors"
            aria-label={t('archive')}
          >
            <Archive className="h-3 w-3" aria-hidden="true" />
            {t('archive')}
          </button>
          <button
            onClick={() => setBulkDeleteConfirm(true)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-red-500 rounded-md hover:bg-red-500/10 transition-colors"
            aria-label={t('delete')}
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" />
            {t('delete')}
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto p-1 rounded-md hover:bg-[hsl(var(--foreground)/0.05)] transition-colors"
            aria-label={t('clearSelection')}
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Memory list */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{t('detail.loading')}</p>
          </div>
        ) : memories.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Brain className="h-10 w-10 text-[hsl(var(--muted-foreground)/0.3)] mb-3" aria-hidden="true" />
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {searchInput ? t('emptySearchTitle') : t('emptyTitle')}
            </p>
            <p className="text-xs text-[hsl(var(--muted-foreground)/0.6)] mt-1">
              {searchInput ? t('emptySearchDescription') : t('emptyDescription')}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {memories.map((memory) => (
              <MemoryCard
                key={memory.id}
                memory={memory}
                selected={selectedIds.has(memory.id)}
                onToggleSelect={() => handleToggleSelect(memory.id)}
                onClick={() => openDetail({ type: 'memory', memoryId: memory.id })}
                onDelete={() => setDeleteConfirmId(memory.id)}
                onArchive={() => void archiveMemory(memory.id)}
              />
            ))}
          </div>
        )}
      </div>

      {showCreateModal && (
        <MemoryCreateModal onClose={() => setShowCreateModal(false)} />
      )}

      {/* Single delete confirmation */}
      <ConfirmDialog
        open={deleteConfirmId !== null}
        variant="destructive"
        title={t('detail.deleteConfirmTitle')}
        message={t('detail.deleteConfirmMessage')}
        confirmLabel={t('detail.deleteConfirmAction')}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setDeleteConfirmId(null)}
      />

      {/* Bulk delete confirmation */}
      <ConfirmDialog
        open={bulkDeleteConfirm}
        variant="destructive"
        title={t('detail.deleteConfirmTitle')}
        message={t('selected', { count: selectedIds.size }) + ' — ' + t('detail.deleteConfirmMessage')}
        confirmLabel={t('detail.deleteConfirmAction')}
        onConfirm={() => void handleConfirmBulkDelete()}
        onCancel={() => setBulkDeleteConfirm(false)}
      />
    </div>
  )
}
