// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2, X } from 'lucide-react'
import { useIssueStore } from '../../stores/issueStore'
import { updateIssueView, deleteIssueView } from '../../actions/issueActions'
import { useExitAnimation } from '../../hooks/useModalAnimation'
import { cn } from '../../lib/utils'
import { ISSUE_STATUS_THEME, ISSUE_PRIORITY_THEME } from '../../constants/issueStatus'
import { IssueStatusIcon, IssuePriorityIcon } from './IssueIcons'
import type {
  IssueView,
  ViewFilters,
  ViewDisplayConfig,
  IssueStatus,
  IssuePriority,
  GroupByField,
  SortConfig
} from '@shared/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_OPTIONS: IssueStatus[] = ['backlog', 'todo', 'in_progress', 'done', 'cancelled']
const PRIORITY_OPTIONS: IssuePriority[] = ['urgent', 'high', 'medium', 'low']

const GROUP_BY_OPTIONS: { value: GroupByField | null; labelKey: string }[] = [
  { value: null, labelKey: 'groupByOptions.none' },
  { value: 'status', labelKey: 'groupByOptions.status' },
  { value: 'priority', labelKey: 'groupByOptions.priority' },
  { value: 'label', labelKey: 'groupByOptions.label' },
  { value: 'project', labelKey: 'groupByOptions.project' }
]

const SORT_FIELD_OPTIONS: { value: SortConfig['field']; labelKey: string }[] = [
  { value: 'updatedAt', labelKey: 'sortFieldOptions.updated' },
  { value: 'createdAt', labelKey: 'sortFieldOptions.created' },
  { value: 'priority', labelKey: 'sortFieldOptions.priority' },
  { value: 'status', labelKey: 'sortFieldOptions.status' }
]

const EMOJI_OPTIONS = ['', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚪', '🐛', '✨', '🚀', '📋', '🎯', '⚡', '🔥', '💎']

// ---------------------------------------------------------------------------
// MultiCheckbox — reusable multi-select checkbox list
// ---------------------------------------------------------------------------

interface MultiCheckboxProps<T extends string> {
  options: { value: T; label: string; icon?: React.ReactNode }[]
  selected: T[]
  onChange: (selected: T[]) => void
}

function MultiCheckbox<T extends string>({
  options,
  selected,
  onChange
}: MultiCheckboxProps<T>): React.JSX.Element {
  const selectedSet = new Set(selected)
  const toggle = (value: T): void => {
    const next = new Set(selectedSet)
    if (next.has(value)) {
      next.delete(value)
    } else {
      next.add(value)
    }
    onChange(Array.from(next))
  }

  return (
    <div className="flex flex-wrap gap-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => toggle(opt.value)}
          className={cn(
            'flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-md border transition-colors',
            selectedSet.has(opt.value)
              ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--foreground))]'
              : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
          )}
        >
          {opt.icon}
          <span>{opt.label}</span>
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ViewEditPopover
// ---------------------------------------------------------------------------

interface ViewEditPopoverProps {
  /** Existing view to edit, or null for create mode */
  view: IssueView | null
  /** Anchor position for the popover */
  anchorRect: DOMRect | null
  /** Called when the popover should close */
  onClose: () => void
}

export function ViewEditPopover({
  view,
  anchorRect,
  onClose
}: ViewEditPopoverProps): React.JSX.Element | null {
  const { t } = useTranslation('issues')
  const { t: tc } = useTranslation('common')
  const createIssueView = useIssueStore((s) => s.createIssueView)
  const customLabels = useIssueStore((s) => s.customLabels)
  const allLabels = customLabels
  const { phase, requestClose } = useExitAnimation(onClose)

  const isEdit = !!view
  const popoverRef = useRef<HTMLDivElement>(null)

  // Form state
  const [name, setName] = useState(view?.name ?? '')
  const [icon, setIcon] = useState(view?.icon ?? '')
  const [statuses, setStatuses] = useState<IssueStatus[]>(view?.filters.statuses ?? [])
  const [priorities, setPriorities] = useState<IssuePriority[]>(view?.filters.priorities ?? [])
  // Defense-in-depth: intersect persisted labels with the current label
  // registry.  The primary cascade cleanup happens in the backend when a
  // label is deleted/renamed (IssueViewStore.purgeLabel / renameLabel),
  // but this guard ensures any stale reference that slipped through
  // (e.g. direct DB edit, migration gap) won't appear as an invisible
  // phantom that the user can't deselect.
  const [labels, setLabels] = useState<string[]>(() => {
    const viewLabels = view?.filters.labels ?? []
    if (viewLabels.length === 0) return []
    const available = new Set(allLabels)
    return viewLabels.filter((l) => available.has(l))
  })
  const [groupBy, setGroupBy] = useState<GroupByField | null>(view?.display.groupBy ?? null)
  const [sortField, setSortField] = useState<SortConfig['field']>(view?.display.sort.field ?? 'updatedAt')
  const [sortOrder, setSortOrder] = useState<SortConfig['order']>(view?.display.sort.order ?? 'desc')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Close on outside click
  useEffect(() => {
    function handleMouseDown(e: MouseEvent): void {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        requestClose()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [requestClose])

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') requestClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [requestClose])

  const handleSave = useCallback(async () => {
    if (!name.trim()) return

    const filters: ViewFilters = {}
    if (statuses.length > 0) filters.statuses = statuses
    if (priorities.length > 0) filters.priorities = priorities
    if (labels.length > 0) filters.labels = labels

    const display: ViewDisplayConfig = {
      groupBy,
      sort: { field: sortField, order: sortOrder }
    }

    if (isEdit && view) {
      await updateIssueView(view.id, { name: name.trim(), icon, filters, display })
    } else {
      await createIssueView({ name: name.trim(), icon, filters, display })
    }
    requestClose()
  }, [name, icon, statuses, priorities, labels, groupBy, sortField, sortOrder, isEdit, view, createIssueView, requestClose])

  const handleDelete = useCallback(async () => {
    if (!view) return
    await deleteIssueView(view.id)
    requestClose()
  }, [view, requestClose])

  // Position the popover below the anchor
  const style: React.CSSProperties = anchorRect
    ? {
        position: 'fixed',
        top: anchorRect.bottom + 4,
        left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - 340)),
        zIndex: 100
      }
    : { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 100 }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[99]" />

      {/* Popover */}
      <div
        ref={popoverRef}
        style={style}
        className={cn(
          'w-[320px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-lg overflow-hidden',
          phase === 'enter' && 'dropdown-enter',
          phase === 'exit' && 'dropdown-exit',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[hsl(var(--border))]">
          <span className="text-xs font-medium">
            {isEdit ? t('viewEdit.editView') : t('viewEdit.createView')}
          </span>
          <button
            onClick={requestClose}
            className="p-0.5 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
            aria-label={tc('close')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-3 max-h-[60vh] overflow-y-auto">
          {/* Name + Icon */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
              {tc('name')}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('viewEdit.viewName')}
                className="flex-1 px-2 py-1.5 text-xs rounded-md border border-[hsl(var(--border))] bg-transparent placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
                autoFocus
              />
            </div>
          </div>

          {/* Icon */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
              {t('viewEdit.icon')}
            </label>
            <div className="flex flex-wrap gap-1">
              {EMOJI_OPTIONS.map((emoji) => (
                <button
                  key={emoji || '__none__'}
                  onClick={() => setIcon(emoji)}
                  className={cn(
                    'w-7 h-7 rounded-md text-sm flex items-center justify-center transition-colors',
                    icon === emoji
                      ? 'bg-[hsl(var(--primary)/0.1)] ring-1 ring-[hsl(var(--primary))]'
                      : 'hover:bg-[hsl(var(--foreground)/0.04)]'
                  )}
                >
                  {emoji || '—'}
                </button>
              ))}
            </div>
          </div>

          {/* Status filter */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
              {t('viewEdit.statusFilter')}
            </label>
            <MultiCheckbox
              options={STATUS_OPTIONS.map((s) => ({
                value: s,
                label: tc(`issueStatus.${s === 'in_progress' ? 'inProgress' : s}`),
                icon: <IssueStatusIcon status={s} className="w-3 h-3" />
              }))}
              selected={statuses}
              onChange={setStatuses}
            />
          </div>

          {/* Priority filter */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
              {t('viewEdit.priorityFilter')}
            </label>
            <MultiCheckbox
              options={PRIORITY_OPTIONS.map((p) => ({
                value: p,
                label: tc(`priority.${p}`),
                icon: <IssuePriorityIcon priority={p} />
              }))}
              selected={priorities}
              onChange={setPriorities}
            />
          </div>

          {/* Label filter */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
              {t('viewEdit.labelFilter')}
            </label>
            <MultiCheckbox
              options={allLabels.map((l) => ({
                value: l,
                label: l
              }))}
              selected={labels}
              onChange={setLabels}
            />
          </div>

          {/* Display config */}
          <div className="space-y-1.5 pt-1 border-t border-[hsl(var(--border))]">
            <label className="block text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
              {tc('display')}
            </label>

            {/* Group By */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[hsl(var(--muted-foreground))] w-14">{tc('groupBy')}</span>
              <select
                value={groupBy ?? ''}
                onChange={(e) => setGroupBy((e.target.value || null) as GroupByField | null)}
                className="flex-1 px-2 py-1 text-xs rounded-md border border-[hsl(var(--border))] bg-transparent focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
              >
                {GROUP_BY_OPTIONS.map((opt) => (
                  <option key={String(opt.value)} value={opt.value ?? ''}>{tc(opt.labelKey)}</option>
                ))}
              </select>
            </div>

            {/* Sort */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[hsl(var(--muted-foreground))] w-14">{tc('sortBy')}</span>
              <select
                value={sortField}
                onChange={(e) => setSortField(e.target.value as SortConfig['field'])}
                className="flex-1 px-2 py-1 text-xs rounded-md border border-[hsl(var(--border))] bg-transparent focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
              >
                {SORT_FIELD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{tc(opt.labelKey)}</option>
                ))}
              </select>
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as SortConfig['order'])}
                className="w-24 px-2 py-1 text-xs rounded-md border border-[hsl(var(--border))] bg-transparent focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
              >
                <option value="desc">{tc('desc')}</option>
                <option value="asc">{tc('asc')}</option>
              </select>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-[hsl(var(--border))]">
          {isEdit ? (
            <div>
              {showDeleteConfirm ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-red-500">{t('viewEdit.deleteViewConfirm')}</span>
                  <button
                    onClick={handleDelete}
                    className="px-2 py-0.5 text-[11px] rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors"
                  >
                    {tc('yes')}
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-2 py-0.5 text-[11px] rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                  >
                    {tc('no')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-1 text-[11px] text-red-500 hover:text-red-600 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  {tc('delete')}
                </button>
              )}
            </div>
          ) : (
            <div />
          )}

          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className={cn(
              'px-3 py-1 text-xs rounded-md font-medium transition-colors',
              name.trim()
                ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary)/0.9)]'
                : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] cursor-not-allowed'
            )}
          >
            {isEdit ? t('viewEdit.saveView') : t('viewEdit.createViewBtn')}
          </button>
        </div>
      </div>
    </>
  )
}
