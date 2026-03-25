// SPDX-License-Identifier: Apache-2.0

import { useCallback, useMemo, useState, memo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { SquarePen, PanelRightOpen, PanelRightClose, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { useCommandStore } from '@/stores/commandStore'
import { useSessionMessages } from '@/hooks/useSessionMessages'
import { deleteSession } from '@/actions/commandActions'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ProjectPicker } from '@/components/ui/ProjectPicker'
import { formatRelativeTime } from '@/components/DetailPanel/SessionPanel/artifactUtils'
import type { TFunction } from 'i18next'
import type { SessionSnapshot, ManagedSessionMessage, ManagedSessionState } from '@shared/types'
import { truncate } from '@shared/unicode'

// ─── Constants ──────────────────────────────────────────────────────────────

/** Sidebar widths in px — both fixed so CSS can smoothly transition between them. */
const SIDEBAR_W_COLLAPSED = 72
const SIDEBAR_W_EXPANDED = 260

// ─── Props ──────────────────────────────────────────────────────────────────

interface AgentSidebarProps {
  /** Pre-filtered session list from `useAgentSession.sessions` (single source of truth). */
  sessions: SessionSnapshot[]
  activeSessionId: string | null
  onSelectSession: (sessionId: string | null) => void
}

// ─── State dot colors ───────────────────────────────────────────────────────

function stateDotClass(state: ManagedSessionState): string {
  switch (state) {
    case 'creating':
    case 'streaming':
      return 'bg-green-400'
    case 'awaiting_input':
    case 'awaiting_question':
      return 'bg-amber-400'
    case 'idle':
    case 'stopped':
    case 'stopping':
      return 'bg-[hsl(var(--muted-foreground)/0.35)]'
    case 'error':
      return 'bg-red-400'
  }
}

// ─── Derive a title from the first user message ─────────────────────────────

function sessionTitle(messages: ManagedSessionMessage[], t: TFunction<'sessions'>): string {
  for (const msg of messages) {
    if (msg.role !== 'user') continue
    for (const block of msg.content) {
      if (block.type === 'text' && block.text.trim()) {
        const text = block.text.trim()
        return truncate(text, { max: 80 })
      }
    }
  }
  return t('agentSidebar.newConversation')
}

// ─── Icon button ────────────────────────────────────────────────────────────

function IconButton({
  icon: Icon,
  label,
  onClick,
  className: extraClass,
}: {
  icon: typeof SquarePen
  label: string
  onClick: () => void
  className?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'p-1.5 rounded-md transition-colors',
        'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
        extraClass,
      )}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
    </button>
  )
}

// ─── Session list item ──────────────────────────────────────────────────────

interface SidebarSessionItemProps {
  session: SessionSnapshot
  isActive: boolean
  onClick: () => void
  onDelete: (sessionId: string) => void
}

const SidebarSessionItem = memo(function SidebarSessionItem({
  session,
  isActive,
  onClick,
  onDelete,
}: SidebarSessionItemProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const messages = useSessionMessages(session.id)
  const title = sessionTitle(messages, t)

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onDelete(session.id)
    },
    [onDelete, session.id],
  )

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-2 rounded-lg transition-colors group relative',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
        isActive
          ? 'bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--foreground))]'
          : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] hover:text-[hsl(var(--foreground))]'
      )}
      aria-current={isActive ? 'true' : undefined}
    >
      <div className="flex items-start gap-2 min-w-0">
        {/* Status dot */}
        <span
          className={cn('mt-1.5 w-1.5 h-1.5 rounded-full shrink-0', stateDotClass(session.state))}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs leading-snug line-clamp-2 break-words pr-5">{title}</p>
          <p className="text-[10px] text-[hsl(var(--muted-foreground)/0.6)] mt-0.5">
            {formatRelativeTime(session.lastActivity)}
          </p>
        </div>
      </div>

      {/* Delete button — appears on hover */}
      <span
        role="button"
        tabIndex={-1}
        onClick={handleDelete}
        aria-label={t('agentSidebar.deleteSessionAria')}
        className={cn(
          'absolute top-2 right-2 p-0.5 rounded transition-opacity',
          'opacity-0 group-hover:opacity-60 hover:!opacity-100',
          'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]',
          'hover:bg-[hsl(var(--foreground)/0.06)]',
        )}
      >
        <X className="w-3 h-3" aria-hidden="true" />
      </span>
    </button>
  )
})

// ─── AgentSidebar ───────────────────────────────────────────────────────────
//
// Single <aside> element for both states — the width transitions smoothly and
// overflow-hidden clips the session content when collapsed. The expand/collapse
// icon is always anchored at the far right so its position never shifts.
// ─────────────────────────────────────────────────────────────────────────────

export function AgentSidebar({
  sessions,
  activeSessionId,
  onSelectSession,
}: AgentSidebarProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const expanded = useAppStore((s) => s.agentSidebarExpanded)
  const setExpanded = useAppStore((s) => s.setAgentSidebarExpanded)

  // ── Delete state ─────────────────────────────────────────────────
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const handleDeleteRequest = useCallback((sessionId: string) => {
    setPendingDeleteId(sessionId)
  }, [])

  const handleDeleteConfirm = useCallback(async () => {
    if (!pendingDeleteId) return
    await deleteSession(pendingDeleteId)
    setPendingDeleteId(null)
  }, [pendingDeleteId])

  const handleDeleteCancel = useCallback(() => {
    setPendingDeleteId(null)
  }, [])

  // ── Project filter state (local — only active when no sidebar project selected) ──
  const sidebarProjectId = useAppStore(selectProjectId)
  const [localProjectFilter, setLocalProjectFilter] = useState<string | null>(null)

  // When sidebar has a project selected, ignore local filter.
  // When no sidebar project, apply local filter.
  const showProjectFilter = !sidebarProjectId
  const effectiveProjectFilter = sidebarProjectId ?? localProjectFilter

  const filteredSessions = useMemo(
    () =>
      effectiveProjectFilter
        ? sessions.filter((s) => s.projectId === effectiveProjectFilter)
        : sessions,
    [sessions, effectiveProjectFilter],
  )

  // ── Handlers ─────────────────────────────────────────────────────

  const handleNewChat = useCallback(() => {
    onSelectSession(null)
  }, [onSelectSession])

  const toggleExpanded = useCallback(() => {
    setExpanded(!expanded)
  }, [expanded, setExpanded])

  return (
    <aside
      style={{ width: expanded ? SIDEBAR_W_EXPANDED : SIDEBAR_W_COLLAPSED }}
      className={cn(
        'shrink-0 flex flex-col bg-[hsl(var(--background))] transition-[width] duration-200 ease-out',
        !expanded && 'overflow-hidden',
      )}
    >
      {/* ── Header: New Chat + Expand/Collapse ───────────────────────── */}
      <div className="flex items-center gap-0.5 shrink-0 pt-2 pr-2 pl-1">
        {/* New chat — icon always visible; label clips when collapsed */}
        <button
          type="button"
          onClick={handleNewChat}
          title={t('agentSidebar.newChat')}
          aria-label={t('agentSidebar.newChatAria')}
          className={cn(
            'flex items-center gap-2 flex-1 min-w-0 px-2.5 py-1.5 rounded-lg overflow-hidden transition-colors',
            'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
          )}
        >
          <SquarePen className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="text-xs font-medium whitespace-nowrap leading-none">{t('agentSidebar.newChat')}</span>
        </button>

        {/* Toggle — always at the far right, stable position */}
        <IconButton
          icon={expanded ? PanelRightClose : PanelRightOpen}
          label={expanded ? t('agentSidebar.collapse') : t('agentSidebar.expand')}
          onClick={toggleExpanded}
          className="shrink-0"
        />
      </div>

      {/* ── Sessions (fade in/out) ───────────────────────────────────── */}
      <div
        className={cn(
          'flex flex-col flex-1 min-h-0 transition-opacity duration-150',
          expanded ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
      >
        {/* Sessions header + project filter */}
        <div className="flex items-center justify-between px-3 pt-4 pb-1.5 mx-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground)/0.6)]">
            {t('agentSidebar.sessions')}
          </span>
          {showProjectFilter && (
            <ProjectPicker
              value={localProjectFilter}
              onChange={setLocalProjectFilter}
              placeholder={t('agentSidebar.allProjects')}
              ariaLabel={t('agentSidebar.filterByProject')}
              triggerClassName="!border-0 !px-1.5 !py-0.5 !text-[10px] !text-[hsl(var(--muted-foreground)/0.7)]"
              portal
            />
          )}
        </div>

        {/* Sessions list (scrollable) */}
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {filteredSessions.length === 0 ? (
            <p className="px-3 py-4 text-xs text-[hsl(var(--muted-foreground)/0.5)] text-center">
              {t('agentSidebar.noSessionsYet')}
            </p>
          ) : (
            filteredSessions.map((session) => (
              <SidebarSessionItem
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                onClick={() => onSelectSession(session.id)}
                onDelete={handleDeleteRequest}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Delete confirmation dialog ──────────────────────────────── */}
      {createPortal(
        <ConfirmDialog
          open={pendingDeleteId !== null}
          title={t('agentSidebar.deleteConfirmTitle')}
          message={t('agentSidebar.deleteConfirmMessage')}
          confirmLabel={t('agentSidebar.deleteSession')}
          variant="destructive"
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        />,
        document.body,
      )}
    </aside>
  )
}
