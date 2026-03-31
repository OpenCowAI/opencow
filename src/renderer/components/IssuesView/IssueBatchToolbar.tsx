// SPDX-License-Identifier: Apache-2.0

/**
 * IssueBatchToolbar — Floating action bar shown when multiple issues are selected.
 *
 * Provides batch operations: status change, priority change, label toggle, delete.
 * Appears as a bottom-anchored pill overlay above the issue list.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  X,
  CheckCircle2,
  ArrowUpCircle,
  Tag,
  Trash2,
} from 'lucide-react'
import { batchUpdateIssues, batchDeleteIssues } from '@/actions/issueActions'
import { useIssueStore } from '@/stores/issueStore'
import { getAppAPI } from '@/windowAPI'
import { ConfirmDialog } from '../ui/confirm-dialog'
import { toast } from '@/lib/toast'
import type { IssueStatus, IssuePriority } from '@shared/types'

// ─── Status / Priority options ──────────────────────────────────────

const STATUS_OPTIONS: { value: IssueStatus; label: string; i18nKey: string }[] = [
  { value: 'backlog', label: 'Backlog', i18nKey: 'issueStatus.backlog' },
  { value: 'todo', label: 'Todo', i18nKey: 'issueStatus.todo' },
  { value: 'in_progress', label: 'In Progress', i18nKey: 'issueStatus.inProgress' },
  { value: 'done', label: 'Done', i18nKey: 'issueStatus.done' },
  { value: 'cancelled', label: 'Cancelled', i18nKey: 'issueStatus.cancelled' },
]

const PRIORITY_OPTIONS: { value: IssuePriority; label: string; i18nKey: string }[] = [
  { value: 'urgent', label: 'Urgent', i18nKey: 'priority.urgent' },
  { value: 'high', label: 'High', i18nKey: 'priority.high' },
  { value: 'medium', label: 'Medium', i18nKey: 'priority.medium' },
  { value: 'low', label: 'Low', i18nKey: 'priority.low' },
]

// ─── Props ──────────────────────────────────────────────────────────

export interface IssueBatchToolbarProps {
  selectedIds: Set<string>
  onClearSelection: () => void
}

// ─── Component ──────────────────────────────────────────────────────

export function IssueBatchToolbar({
  selectedIds,
  onClearSelection,
}: IssueBatchToolbarProps): React.JSX.Element | null {
  const { t } = useTranslation('issues')
  const { t: tc } = useTranslation('common')
  const customLabels = useIssueStore((s) => s.customLabels)

  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [showPriorityMenu, setShowPriorityMenu] = useState(false)
  const [showLabelMenu, setShowLabelMenu] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  const toolbarRef = useRef<HTMLDivElement>(null)
  const anyMenuOpen = showStatusMenu || showPriorityMenu || showLabelMenu

  // Close dropdown menus on outside click
  useEffect(() => {
    if (!anyMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setShowStatusMenu(false)
        setShowPriorityMenu(false)
        setShowLabelMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [anyMenuOpen])

  const count = selectedIds.size
  const ids = useMemo(() => Array.from(selectedIds), [selectedIds])

  const closeMenus = useCallback(() => {
    setShowStatusMenu(false)
    setShowPriorityMenu(false)
    setShowLabelMenu(false)
  }, [])

  const handleSetStatus = useCallback(async (status: IssueStatus) => {
    closeMenus()
    setBusy(true)
    try {
      const updated = await batchUpdateIssues(ids, { status })
      toast(t('batch.statusUpdated', { count: updated.length }))
      onClearSelection()
    } finally {
      setBusy(false)
    }
  }, [ids, closeMenus, t, onClearSelection])

  const handleSetPriority = useCallback(async (priority: IssuePriority) => {
    closeMenus()
    setBusy(true)
    try {
      const updated = await batchUpdateIssues(ids, { priority })
      toast(t('batch.priorityUpdated', { count: updated.length }))
      onClearSelection()
    } finally {
      setBusy(false)
    }
  }, [ids, closeMenus, t, onClearSelection])

  const handleAddLabel = useCallback(async (label: string) => {
    closeMenus()
    setBusy(true)
    try {
      // Add the label to each selected issue (labels differ per issue).
      // Call IPC directly to avoid N redundant loadIssues() calls,
      // then reload the list once after all updates complete.
      const api = getAppAPI()
      const issueById = useIssueStore.getState().issueById
      const updates: Promise<unknown>[] = []
      for (const id of ids) {
        const existing = issueById[id]
        if (!existing) continue
        const currentLabels = existing.labels ?? []
        if (currentLabels.includes(label)) continue // already has this label
        updates.push(api['update-issue'](id, { labels: [...currentLabels, label] }))
      }
      const results = await Promise.allSettled(updates)
      const successCount = results.filter((r) => r.status === 'fulfilled').length
      // Single reload after all IPC calls complete
      await useIssueStore.getState().loadIssues()
      toast(t('batch.labelUpdated', { count: successCount, label }))
      onClearSelection()
    } finally {
      setBusy(false)
    }
  }, [ids, closeMenus, t, onClearSelection])

  const handleDelete = useCallback(async () => {
    setShowDeleteConfirm(false)
    setBusy(true)
    try {
      const deleted = await batchDeleteIssues(ids)
      toast(t('batch.deleted', { count: deleted }))
      onClearSelection()
    } finally {
      setBusy(false)
    }
  }, [ids, t, onClearSelection])

  // ── Early return AFTER all hooks ──────────────────────────────────
  if (count === 0) return null

  return (
    <>
      {/* Floating toolbar */}
      <div ref={toolbarRef} className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 px-3 py-1.5 rounded-full bg-[hsl(var(--popover))] border border-[hsl(var(--border))] shadow-lg">
        {/* Count + clear */}
        <span className="text-xs font-medium text-[hsl(var(--foreground))] mr-1">
          {t('batch.selected', { count })}
        </span>
        <button
          onClick={onClearSelection}
          className="p-1 rounded-full hover:bg-[hsl(var(--foreground)/0.06)] transition-colors"
          aria-label={t('batch.clearSelection')}
        >
          <X className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
        </button>

        <span className="w-px h-4 bg-[hsl(var(--border)/0.5)]" />

        {/* Status */}
        <div className="relative">
          <button
            onClick={() => { closeMenus(); setShowStatusMenu(!showStatusMenu) }}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs hover:bg-[hsl(var(--foreground)/0.06)] transition-colors disabled:opacity-50"
            aria-label={t('batch.setStatus')}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{tc('groupByOptions.status')}</span>
          </button>
          {showStatusMenu && (
            <div className="absolute bottom-full left-0 mb-1 min-w-[140px] rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-md py-1">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleSetStatus(opt.value)}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[hsl(var(--foreground)/0.06)] transition-colors"
                >
                  {tc(opt.i18nKey)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Priority */}
        <div className="relative">
          <button
            onClick={() => { closeMenus(); setShowPriorityMenu(!showPriorityMenu) }}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs hover:bg-[hsl(var(--foreground)/0.06)] transition-colors disabled:opacity-50"
            aria-label={t('batch.setPriority')}
          >
            <ArrowUpCircle className="w-3.5 h-3.5" />
            <span>{tc('groupByOptions.priority')}</span>
          </button>
          {showPriorityMenu && (
            <div className="absolute bottom-full left-0 mb-1 min-w-[120px] rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-md py-1">
              {PRIORITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleSetPriority(opt.value)}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[hsl(var(--foreground)/0.06)] transition-colors"
                >
                  {tc(opt.i18nKey)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Labels */}
        {customLabels.length > 0 && (
          <div className="relative">
            <button
              onClick={() => { closeMenus(); setShowLabelMenu(!showLabelMenu) }}
              disabled={busy}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs hover:bg-[hsl(var(--foreground)/0.06)] transition-colors disabled:opacity-50"
              aria-label={t('batch.addLabel')}
            >
              <Tag className="w-3.5 h-3.5" />
              <span>{tc('groupByOptions.label')}</span>
            </button>
            {showLabelMenu && (
              <div className="absolute bottom-full left-0 mb-1 min-w-[120px] max-h-[200px] overflow-y-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-md py-1">
                {customLabels.map((label) => (
                  <button
                    key={label}
                    onClick={() => handleAddLabel(label)}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-[hsl(var(--foreground)/0.06)] transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <span className="w-px h-4 bg-[hsl(var(--border)/0.5)]" />

        {/* Delete */}
        <button
          onClick={() => { closeMenus(); setShowDeleteConfirm(true) }}
          disabled={busy}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
          aria-label={t('batch.delete')}
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>{tc('delete')}</span>
        </button>
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title={t('batch.deleteTitle')}
        message={t('batch.deleteMessage', { count })}
        confirmLabel={tc('delete')}
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  )
}
