// SPDX-License-Identifier: Apache-2.0

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, SquarePen, X } from 'lucide-react'
import type { TFunction } from 'i18next'
import { cn } from '@/lib/utils'
import { surfaceProps } from '@/lib/surface'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { useModalAnimation } from '@/hooks/useModalAnimation'
import { useSessionMessages } from '@/hooks/useSessionMessages'
import { deleteSession } from '@/actions/commandActions'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ProjectPicker } from '@/components/ui/ProjectPicker'
import { formatRelativeTime } from '@/components/DetailPanel/SessionPanel/artifactUtils'
import { truncate } from '@shared/unicode'
import type {
  ManagedSessionMessage,
  ManagedSessionState,
  SessionSnapshot,
} from '@shared/types'

const VIEWPORT_MARGIN = 8

// ─── State dot color ────────────────────────────────────────────────

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

// ─── Derive a title from the first user message ────────────────────

function sessionTitle(messages: ManagedSessionMessage[], t: TFunction<'sessions'>): string {
  for (const msg of messages) {
    if (msg.role !== 'user') continue
    for (const block of msg.content) {
      if (block.type === 'text' && block.text.trim()) {
        const text = block.text.trim()
        return truncate(text, { max: 60 })
      }
    }
  }
  return t('agentSidebar.newConversation')
}

// ─── Active session title (dropdown trigger label) ─────────────────

function ActiveSessionTitle({
  sessionId,
}: {
  sessionId: string
}): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const messages = useSessionMessages(sessionId)
  const title = sessionTitle(messages, t)
  return <span className="truncate">{title}</span>
}

// ─── Session list item ─────────────────────────────────────────────

interface SessionItemProps {
  session: SessionSnapshot
  isActive: boolean
  onClick: () => void
  onDelete: (sessionId: string) => void
}

const SessionItem = memo(function SessionItem({
  session,
  isActive,
  onClick,
  onDelete,
}: SessionItemProps): React.JSX.Element {
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
      type="button"
      onClick={onClick}
      className={cn(
        'group relative w-full text-left px-3 py-2 rounded-lg transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
        isActive
          ? 'bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--foreground))]'
          : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] hover:text-[hsl(var(--foreground))]',
      )}
      aria-current={isActive ? 'true' : undefined}
    >
      <div className="flex items-start gap-2 min-w-0">
        <span
          className={cn('mt-1.5 w-1.5 h-1.5 rounded-full shrink-0', stateDotClass(session.state))}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug line-clamp-2 break-words pr-5">{title}</p>
          <p className="text-[11px] text-[hsl(var(--muted-foreground)/0.6)] mt-0.5">
            {formatRelativeTime(session.lastActivity)}
          </p>
        </div>
      </div>

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

// ─── ChatHeader ────────────────────────────────────────────────────

interface ChatHeaderProps {
  sessions: SessionSnapshot[]
  activeSessionId: string | null
  onSelectSession: (sessionId: string | null) => void
}

/**
 * Top bar of the Agent chat panel.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ ▼ <session title>                          + 新建对话         │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Replaces the legacy AgentSidebar — the title acts as a dropdown
 * trigger that lists all sessions for the current project (or all
 * projects when no project is selected). The right-aligned "+" button
 * starts a new conversation.
 */
export function ChatHeader({
  sessions,
  activeSessionId,
  onSelectSession,
}: ChatHeaderProps): React.JSX.Element {
  const { t } = useTranslation('sessions')

  // ── Dropdown lifecycle ──────────────────────────────────────────
  const [open, setOpen] = useState(false)
  const { mounted, phase } = useModalAnimation(open)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const handleMouseDown = (e: MouseEvent): void => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        close()
      }
    }
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, close])

  // ── Position the popover under the trigger ──────────────────────
  // Popover width is fixed to a comfortable session-list width (320px),
  // not stretched to the trigger — the title button can grow with the
  // chat panel due to flex layout, but the dropdown should stay compact.
  const POPOVER_W = 320
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    if (!mounted || !triggerRef.current || !popoverRef.current) return
    const trig = triggerRef.current.getBoundingClientRect()
    const { height } = popoverRef.current.getBoundingClientRect()
    let x = trig.left
    let y = trig.bottom + 4
    if (x + POPOVER_W + VIEWPORT_MARGIN > window.innerWidth) {
      x = Math.max(VIEWPORT_MARGIN, trig.right - POPOVER_W)
    }
    if (y + height + VIEWPORT_MARGIN > window.innerHeight) {
      y = Math.max(VIEWPORT_MARGIN, trig.top - height - 4)
    }
    setPos({ x, y })
  }, [mounted])

  useEffect(() => {
    if (!mounted) setPos(null)
  }, [mounted])

  // ── Session filter ─────────────────────────────────────────────
  //
  // Three modes:
  //   1. Chat home (path === $HOME) → show only sessions with no
  //      associated project (project_id IS NULL). These are claude
  //      runs that happened in `$HOME` outside OpenCow's project model.
  //      The project filter chip is hidden — the filter is implicit.
  //   2. Specific project selected → restrict to that project's
  //      sessions (no manual filter chip, scope is unambiguous).
  //   3. Project list mode (no project) → show all sessions across
  //      projects, with a ProjectPicker chip to narrow manually.
  const sidebarProjectId = useAppStore(selectProjectId)
  const homeDir = useAppStore((s) => s.homeDir)
  const currentProject = useAppStore((s) =>
    sidebarProjectId ? s.projects.find((p) => p.id === sidebarProjectId) ?? null : null,
  )
  const isChatHome =
    homeDir !== null && currentProject !== null && currentProject.path === homeDir

  const [localProjectFilter, setLocalProjectFilter] = useState<string | null>(null)
  // Manual filter chip is only useful in the "no project" landing case.
  const showProjectFilter = !sidebarProjectId && !isChatHome
  const effectiveProjectFilter = sidebarProjectId ?? localProjectFilter

  const filteredSessions = useMemo(() => {
    if (isChatHome) return sessions.filter((s) => !s.projectId)
    if (effectiveProjectFilter) {
      return sessions.filter((s) => s.projectId === effectiveProjectFilter)
    }
    return sessions
  }, [sessions, effectiveProjectFilter, isChatHome])

  // ── Delete state ────────────────────────────────────────────────
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

  // ── Handlers ───────────────────────────────────────────────────
  const handleSelect = useCallback(
    (sessionId: string | null) => {
      close()
      onSelectSession(sessionId)
    },
    [close, onSelectSession],
  )

  const handleNewChat = useCallback(() => {
    onSelectSession(null)
  }, [onSelectSession])

  return (
    <div className="shrink-0 flex items-center justify-between gap-2 px-3 h-10">
      {/* Left — session title dropdown trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'no-drag group flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors',
          'text-[hsl(var(--foreground))]',
          open
            ? 'bg-[hsl(var(--foreground)/0.06)]'
            : 'hover:bg-[hsl(var(--foreground)/0.04)]',
        )}
      >
        <span className="min-w-0 flex-1 truncate text-left font-medium">
          {activeSessionId ? (
            <ActiveSessionTitle sessionId={activeSessionId} />
          ) : (
            <span className="text-[hsl(var(--muted-foreground))]">
              {t('agentSidebar.newConversation')}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform duration-200',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      {/* Right — new chat button */}
      <button
        type="button"
        onClick={handleNewChat}
        title={t('agentSidebar.newChat')}
        aria-label={t('agentSidebar.newChatAria')}
        className={cn(
          'no-drag shrink-0 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors',
          'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] hover:text-[hsl(var(--foreground))]',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
        )}
      >
        <SquarePen className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{t('agentSidebar.newChat')}</span>
      </button>

      {/* Dropdown — portal */}
      {mounted && createPortal(
        <div
          ref={popoverRef}
          role="menu"
          aria-label={t('agentSidebar.sessions')}
          {...surfaceProps({ elevation: 'floating', color: 'popover' })}
          className={cn(
            'fixed z-[60] flex flex-col rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-lg p-2',
            phase === 'enter' && 'dropdown-enter',
            phase === 'exit' && 'dropdown-exit',
          )}
          style={{
            top: pos?.y ?? -9999,
            left: pos?.x ?? -9999,
            width: POPOVER_W,
            maxHeight: 'min(60vh, 480px)',
            visibility: pos ? 'visible' : 'hidden',
          }}
        >
          <div className="flex items-center justify-between px-2 pb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground)/0.7)]">
              {t('agentSidebar.sessions')}
            </span>
            {showProjectFilter && (
              <ProjectPicker
                value={localProjectFilter}
                onChange={setLocalProjectFilter}
                placeholder={t('agentSidebar.allProjects')}
                ariaLabel={t('agentSidebar.filterByProject')}
                triggerClassName="!border-0 !px-1.5 !py-0.5 !text-[11px] !text-[hsl(var(--muted-foreground)/0.7)]"
                portal
              />
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5">
            {filteredSessions.length === 0 ? (
              <p className="px-3 py-4 text-sm text-[hsl(var(--muted-foreground)/0.5)] text-center">
                {t('agentSidebar.noSessionsYet')}
              </p>
            ) : (
              filteredSessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                  onClick={() => handleSelect(session.id)}
                  onDelete={handleDeleteRequest}
                />
              ))
            )}
          </div>
        </div>,
        document.body,
      )}

      {/* Delete confirmation */}
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
    </div>
  )
}
