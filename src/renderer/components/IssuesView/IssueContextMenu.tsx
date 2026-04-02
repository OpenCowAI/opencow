// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Copy, ChevronRight, Tag, Trash2, GitBranch, CircleDot, Play } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../stores/appStore'
import { useIssueStore } from '../../stores/issueStore'
import { startSession } from '@/actions/commandActions'
import { useExitAnimation } from '../../hooks/useModalAnimation'
import { IssueStatusIcon, IssuePriorityIcon } from './IssueIcons'
import { ISSUE_STATUS_THEME, ISSUE_PRIORITY_THEME } from '../../constants/issueStatus'
import { isIssueUnread } from '@shared/types'
import type { IssueSummary, IssueStatus, IssuePriority } from '@shared/types'
import { buildIssueSessionPrompt } from '../../lib/issueSessionUtils'
import { getAppAPI } from '@/windowAPI'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_OPTIONS: IssueStatus[] = ['backlog', 'todo', 'in_progress', 'done', 'cancelled']
const PRIORITY_OPTIONS: IssuePriority[] = ['urgent', 'high', 'medium', 'low']

const MENU_ITEM =
  'w-full flex items-center gap-2 px-3 py-1.5 text-sm outline-none cursor-default select-none transition-colors text-left'

const VIEWPORT_PADDING = 8
const HOVER_BRIDGE_DELAY = 120

type HoveredSection = 'status' | 'priority' | 'label'

// ---------------------------------------------------------------------------
// Checkbox — same visual style as EphemeralFilterBar
// ---------------------------------------------------------------------------

function Checkbox({ checked }: { checked: boolean }): React.JSX.Element {
  return (
    <span
      className={cn(
        'w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0',
        checked
          ? 'bg-[hsl(var(--primary))] border-[hsl(var(--primary))]'
          : 'border-[hsl(var(--border))]'
      )}
    >
      {checked && (
        <svg
          className="w-2.5 h-2.5 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// ContextSubMenu — fly-out submenu (same cascade interaction as Filter)
// ---------------------------------------------------------------------------

interface SubMenuPosition {
  /** Preferred x: right side of main menu */
  x: number
  y: number
  /** Fallback x: left edge of main menu, for flipping when right overflows */
  leftFallbackX: number
}

interface ContextSubMenuProps {
  type: HoveredSection
  issue: IssueSummary
  availableLabels: string[]
  position: SubMenuPosition
  onSetStatus: (status: IssueStatus) => void
  onSetPriority: (priority: IssuePriority) => void
  onToggleLabel: (label: string) => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

function ContextSubMenu({
  type,
  issue,
  availableLabels,
  position,
  onSetStatus,
  onSetPriority,
  onToggleLabel,
  onMouseEnter,
  onMouseLeave,
}: ContextSubMenuProps): React.JSX.Element {
  const { t } = useTranslation('issues')
  const { t: tc } = useTranslation('common')
  const subRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: position.x, y: position.y })

  // Edge-aware positioning: flip left if overflowing right, clamp bottom
  useLayoutEffect(() => {
    const el = subRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let x = position.x
    let y = position.y

    if (x + rect.width > vw - VIEWPORT_PADDING) {
      // Flip to left side of main menu
      x = Math.max(VIEWPORT_PADDING, position.leftFallbackX - rect.width)
    }
    if (y + rect.height > vh - VIEWPORT_PADDING) {
      y = Math.max(VIEWPORT_PADDING, vh - rect.height - VIEWPORT_PADDING)
    }
    setPos({ x, y })
  }, [position])

  const panelClass =
    'fixed z-[60] min-w-[180px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-md dropdown-enter'
  const rowClass =
    'w-full flex items-center gap-2 px-3 py-1.5 text-xs cursor-default select-none transition-colors hover:bg-[hsl(var(--foreground)/0.04)] text-left'

  if (type === 'status') {
    return (
      <div
        ref={subRef}
        role="menu"
        aria-label={t('context.setStatus')}
        className={panelClass}
        style={{ top: pos.y, left: pos.x }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div className="py-1">
          {STATUS_OPTIONS.map((status) => (
            <button
              key={status}
              role="menuitem"
              onClick={() => onSetStatus(status)}
              className={rowClass}
            >
              <Checkbox checked={issue.status === status} />
              <IssueStatusIcon status={status} className="w-3.5 h-3.5" />
              <span>{tc(`issueStatus.${status === 'in_progress' ? 'inProgress' : status}`)}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (type === 'priority') {
    return (
      <div
        ref={subRef}
        role="menu"
        aria-label={t('context.setPriority')}
        className={panelClass}
        style={{ top: pos.y, left: pos.x }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div className="py-1">
          {PRIORITY_OPTIONS.map((priority) => (
            <button
              key={priority}
              role="menuitem"
              onClick={() => onSetPriority(priority)}
              className={rowClass}
            >
              <Checkbox checked={issue.priority === priority} />
              <IssuePriorityIcon priority={priority} className="w-3.5 h-3.5" />
              <span>{tc(`priority.${priority}`)}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // Labels — multi-select
  const issueLabels = new Set(issue.labels)
  return (
    <div
      ref={subRef}
      role="menu"
      aria-label={t('context.setLabels')}
      className={panelClass}
      style={{ top: pos.y, left: pos.x }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="py-1 max-h-48 overflow-y-auto">
        {availableLabels.length === 0 ? (
          <p className="px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
            {t('context.noLabelsAvailable')}
          </p>
        ) : (
          availableLabels.map((label) => (
            <button
              key={label}
              role="menuitem"
              onClick={() => onToggleLabel(label)}
              className={rowClass}
            >
              <Checkbox checked={issueLabels.has(label)} />
              <Tag className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] shrink-0" aria-hidden="true" />
              <span className="truncate">{label}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// IssueContextMenu
// ---------------------------------------------------------------------------

interface IssueContextMenuProps {
  issue: IssueSummary
  position: { x: number; y: number }
  onClose: () => void
  onEdit: () => void
  onAddSubIssue: () => void
  onRequestDelete: () => void
}

export function IssueContextMenu({
  issue,
  position,
  onClose,
  onEdit,
  onAddSubIssue,
  onRequestDelete
}: IssueContextMenuProps): React.JSX.Element {
  const { t } = useTranslation('issues')
  const { t: tc } = useTranslation('common')
  const updateIssue = useIssueStore((s) => s.updateIssue)
  const markIssueUnread = useIssueStore((s) => s.markIssueUnread)
  const customLabels = useIssueStore((s) => s.customLabels)
  const projects = useAppStore((s) => s.projects)
  const menuRef = useRef<HTMLDivElement>(null)
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { phase, requestClose } = useExitAnimation(onClose)

  const [hoveredSection, setHoveredSection] = useState<HoveredSection | null>(null)
  const [submenuPos, setSubmenuPos] = useState<SubMenuPosition>({ x: 0, y: 0, leftFallbackX: 0 })
  const [idCopied, setIdCopied] = useState(false)
  const [adjustedPos, setAdjustedPos] = useState(position)

  // Read the latest issue from store so status/priority/labels stay fresh.
  // O(1) lookup via normalized issueById — no full-array scan.
  const latestIssue = useIssueStore((s) => s.issueById[issue.id]) ?? issue

  const availableLabels = customLabels

  // --- Close on click-outside & Escape ---
  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        requestClose()
      }
    }
    function handleEscape(e: KeyboardEvent): void {
      if (e.key === 'Escape') requestClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [requestClose])

  // --- Auto-focus first button ---
  useEffect(() => {
    const firstBtn = menuRef.current?.querySelector('button')
    firstBtn?.focus()
  }, [])

  // --- Viewport edge-aware positioning for main menu ---
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    let x = position.x
    let y = position.y

    if (x + rect.width > vw - VIEWPORT_PADDING) {
      x = Math.max(VIEWPORT_PADDING, vw - rect.width - VIEWPORT_PADDING)
    }
    if (y + rect.height > vh - VIEWPORT_PADDING) {
      y = Math.max(VIEWPORT_PADDING, vh - rect.height - VIEWPORT_PADDING)
    }

    setAdjustedPos({ x, y })
  }, [position])

  // Cleanup hover timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    }
  }, [])

  // --- Hover section management (with bridge delay so mouse can move to submenu) ---

  const handleEnterSection = useCallback(
    (section: HoveredSection, e: React.MouseEvent<HTMLButtonElement>) => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
        hoverTimeoutRef.current = null
      }
      if (menuRef.current) {
        const menuRect = menuRef.current.getBoundingClientRect()
        const rowRect = e.currentTarget.getBoundingClientRect()
        setSubmenuPos({
          x: menuRect.right + 4,
          y: rowRect.top,
          leftFallbackX: menuRect.left - 4
        })
      }
      setHoveredSection(section)
    },
    []
  )

  const handleLeaveSection = useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredSection(null)
    }, HOVER_BRIDGE_DELAY)
  }, [])

  const handleSubMenuEnter = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
  }, [])

  const handleSubMenuLeave = useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredSection(null)
    }, HOVER_BRIDGE_DELAY)
  }, [])

  // --- Action handlers ---

  const handleEdit = (): void => {
    onEdit()
  }

  const handleAddSubIssue = (): void => {
    onAddSubIssue()
  }

  const handleCopyId = (): void => {
    getAppAPI()['clipboard:write-text'](latestIssue.id)
    setIdCopied(true)
    setTimeout(() => {
      setIdCopied(false)
      requestClose()
    }, 600)
  }

  const handleStatusChange = async (status: IssueStatus): Promise<void> => {
    await updateIssue(latestIssue.id, { status })
    requestClose()
  }

  const handlePriorityChange = async (priority: IssuePriority): Promise<void> => {
    await updateIssue(latestIssue.id, { priority })
    requestClose()
  }

  const handleToggleLabel = async (label: string): Promise<void> => {
    const current = new Set(latestIssue.labels)
    if (current.has(label)) {
      current.delete(label)
    } else {
      current.add(label)
    }
    await updateIssue(latestIssue.id, { labels: Array.from(current) })
    // Don't close — user may want to toggle multiple labels
  }

  const handleMarkUnread = async (): Promise<void> => {
    await markIssueUnread(latestIssue.id)
    requestClose()
  }

  const handleDelete = (): void => {
    onRequestDelete()
  }

  const handleStartSession = async (): Promise<void> => {
    try {
      const fullIssue = await getAppAPI()['get-issue'](latestIssue.id)
      if (!fullIssue) return
      const { prompt, workspace } = await buildIssueSessionPrompt(fullIssue, {
        projects,
        actionText: t('pleaseWorkOnIssue'),
      })
      await startSession({
        prompt,
        origin: { source: 'issue', issueId: fullIssue.id },
        workspace,
      })
      requestClose()
    } catch {
      // Errors are surfaced by startSession's own error handling
    }
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Issue actions"
      className={cn(
        'fixed z-50 min-w-[200px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-md py-1',
        phase === 'enter' && 'dropdown-enter',
        phase === 'exit' && 'dropdown-exit',
      )}
      style={{ top: adjustedPos.y, left: adjustedPos.x }}
    >
      {/* ---- Group 1: Navigation ---- */}
      <button
        role="menuitem"
        onClick={handleEdit}
        className={cn(MENU_ITEM, 'hover:bg-[hsl(var(--foreground)/0.04)]')}
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        {t('context.editIssue')}
      </button>

      {/* ---- Separator ---- */}
      <div className="my-1 h-px bg-[hsl(var(--border))]" role="separator" />

      {/* ---- Group 2: Set Status ---- */}
      <button
        role="menuitem"
        onMouseEnter={(e) => handleEnterSection('status', e)}
        onMouseLeave={handleLeaveSection}
        className={cn(
          MENU_ITEM,
          hoveredSection === 'status'
            ? 'bg-[hsl(var(--foreground)/0.06)]'
            : 'hover:bg-[hsl(var(--foreground)/0.04)]'
        )}
      >
        <IssueStatusIcon status={latestIssue.status} className="w-3.5 h-3.5" />
        <span className="flex-1">{t('context.setStatus')}</span>
        <ChevronRight className="h-3 w-3 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
      </button>

      {/* ---- Group 3: Set Labels ---- */}
      <button
        role="menuitem"
        onMouseEnter={(e) => handleEnterSection('label', e)}
        onMouseLeave={handleLeaveSection}
        className={cn(
          MENU_ITEM,
          hoveredSection === 'label'
            ? 'bg-[hsl(var(--foreground)/0.06)]'
            : 'hover:bg-[hsl(var(--foreground)/0.04)]'
        )}
      >
        <Tag className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
        <span className="flex-1">{t('context.setLabels')}</span>
        {latestIssue.labels.length > 0 && (
          <span className="text-xs text-[hsl(var(--muted-foreground))] mr-1">
            {latestIssue.labels.length}
          </span>
        )}
        <ChevronRight className="h-3 w-3 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
      </button>

      {/* ---- Group 4: Set Priority ---- */}
      <button
        role="menuitem"
        onMouseEnter={(e) => handleEnterSection('priority', e)}
        onMouseLeave={handleLeaveSection}
        className={cn(
          MENU_ITEM,
          hoveredSection === 'priority'
            ? 'bg-[hsl(var(--foreground)/0.06)]'
            : 'hover:bg-[hsl(var(--foreground)/0.04)]'
        )}
      >
        <IssuePriorityIcon priority={latestIssue.priority} className="w-3.5 h-3.5" />
        <span className="flex-1">{t('context.setPriority')}</span>
        <ChevronRight className="h-3 w-3 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
      </button>

      {/* ---- Separator ---- */}
      <div className="my-1 h-px bg-[hsl(var(--border))]" role="separator" />

      {/* ---- Mark as Unread (only when issue is currently read) ---- */}
      {!isIssueUnread(latestIssue) && (
        <button
          role="menuitem"
          onClick={handleMarkUnread}
          className={cn(MENU_ITEM, 'hover:bg-[hsl(var(--foreground)/0.04)]')}
        >
          <CircleDot className="h-3.5 w-3.5" aria-hidden="true" />
          {t('context.markAsUnread')}
        </button>
      )}

      {/* Add Sub-Issue — only for top-level issues (single hierarchy depth) */}
      {!latestIssue.parentIssueId && (
        <button
          role="menuitem"
          onClick={handleAddSubIssue}
          className={cn(MENU_ITEM, 'hover:bg-[hsl(var(--foreground)/0.04)]')}
        >
          <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
          {t('context.addSubIssue')}
        </button>
      )}

      {/* ---- Start Session (only when no session is linked) ---- */}
      {!latestIssue.sessionId && (
        <button
          role="menuitem"
          onClick={handleStartSession}
          className={cn(MENU_ITEM, 'hover:bg-[hsl(var(--foreground)/0.04)]')}
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
          {t('context.startSession')}
        </button>
      )}

      {/* ---- Copy ID ---- */}
      <button
        role="menuitem"
        onClick={handleCopyId}
        className={cn(MENU_ITEM, 'hover:bg-[hsl(var(--foreground)/0.04)]')}
      >
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        {idCopied ? tc('copied') : t('context.copyIssueId')}
      </button>

      {/* ---- Group 5: Destructive ---- */}
      <button
        role="menuitem"
        onClick={handleDelete}
        className={cn(MENU_ITEM, 'text-red-500 hover:bg-[hsl(var(--foreground)/0.04)] hover:text-red-500')}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        {t('context.deleteIssue')}
      </button>

      {/* ---- Fly-out submenu (rendered inside menuRef for correct click-outside detection) ---- */}
      {hoveredSection && (
        <ContextSubMenu
          type={hoveredSection}
          issue={latestIssue}
          availableLabels={availableLabels}
          position={submenuPos}
          onSetStatus={handleStatusChange}
          onSetPriority={handlePriorityChange}
          onToggleLabel={handleToggleLabel}
          onMouseEnter={handleSubMenuEnter}
          onMouseLeave={handleSubMenuLeave}
        />
      )}
    </div>
  )
}
