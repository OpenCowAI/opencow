// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare, Loader2, SquarePen, ChevronDown } from 'lucide-react'
import { SessionChatLayout } from './SessionChatLayout'
import { ChatHeroInput } from './ChatHeroInput'
import { ProjectScopeProvider } from '@/contexts/ProjectScopeContext'
import { ContextFilesProvider } from '@/contexts/ContextFilesContext'
import { ContextFileDropZone } from '@/components/DetailPanel/ContextFileDropZone'
import { PillDropdown } from '@/components/ui/PillDropdown'
import { formatRelativeTime } from '@/components/DetailPanel/SessionPanel/artifactUtils'
import { cn } from '@/lib/utils'
import type { AgentSessionHandle } from '@/hooks/useAgentSession'
import { useSessionMessages } from '@/hooks/useSessionMessages'
import type { SessionSnapshot, ManagedSessionMessage, ManagedSessionState, UserMessageContent } from '@shared/types'
import type { TFunction } from 'i18next'
import { truncate } from '@shared/unicode'
import { useContextFiles } from '@/contexts/ContextFilesContext'

// ════════════════════════════════════════════════════════════════════
// ChatPanel — Compact conversation panel for Files view mode.
//
// Design principles:
//   - Thin glue layer: composes existing primitives, no logic duplication.
//   - Receives an AgentSessionHandle from the parent (shared with AgentChatView).
//   - Header with new-chat + session picker (compact dropdown).
//   - Compact empty state instead of full-screen hero landing.
// ════════════════════════════════════════════════════════════════════

interface ChatPanelProps {
  agent: AgentSessionHandle
}

export function ChatPanel({ agent }: ChatPanelProps): React.JSX.Element {
  return (
    <ProjectScopeProvider projectPath={agent.projectPath} projectId={agent.projectId ?? undefined}>
      <ContextFilesProvider>
        <ChatPanelContainer agent={agent} />
      </ContextFilesProvider>
    </ProjectScopeProvider>
  )
}

function ChatPanelContainer({ agent }: ChatPanelProps): React.JSX.Element {
  const { addFiles } = useContextFiles()

  return (
    <ContextFileDropZone
      className="h-full flex flex-col bg-[hsl(var(--background))]"
      onFilesDrop={({ files }) => addFiles(files)}
    >
      <ChatPanelHeader agent={agent} />
      <ChatPanelBody agent={agent} />
    </ContextFileDropZone>
  )
}

// ═══════════════════════════════════════════════════════════════════
// Header — Session title + New chat + Session picker
// ═══════════════════════════════════════════════════════════════════

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

function ChatPanelHeader({ agent }: { agent: AgentSessionHandle }): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const [pickerOpen, setPickerOpen] = useState(false)

  const handleNewChat = useCallback(() => {
    agent.selectSession(null)
    setPickerOpen(false)
  }, [agent])

  const handleSelectSession = useCallback(
    (id: string) => {
      agent.selectSession(id)
      setPickerOpen(false)
    },
    [agent]
  )

  const messages = useSessionMessages(agent.session?.id ?? null)
  const title = agent.session ? sessionTitle(messages, t) : t('agentChat.chat')

  return (
    <div className="mt-9 flex items-center gap-1.5 px-2 py-1.5 border-b border-[hsl(var(--border)/0.3)] shrink-0">
      {/* Session title + picker trigger */}
      <PillDropdown
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        position="below"
        align="left"
        className="min-w-0"
        dropdownClassName="w-[min(360px,calc(100vw-24px))]"
        trigger={
          <button
            onClick={() => setPickerOpen((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 min-w-0 max-w-full overflow-hidden px-2 py-1 rounded-lg text-xs transition-colors',
              'hover:bg-[hsl(var(--foreground)/0.04)]',
              pickerOpen && 'bg-[hsl(var(--foreground)/0.06)]'
            )}
          >
            {/* Status dot */}
            {agent.state && (
              <span
                className={cn('w-1.5 h-1.5 rounded-full shrink-0', stateDotClass(agent.state))}
                aria-hidden="true"
              />
            )}
            {!agent.state && (
              <MessageSquare
                className="w-3 h-3 shrink-0 text-[hsl(var(--muted-foreground))]"
                aria-hidden="true"
              />
            )}
            <span className="truncate font-medium text-[hsl(var(--foreground))]">{title}</span>
            <ChevronDown
              className="w-3 h-3 shrink-0 text-[hsl(var(--muted-foreground))]"
              aria-hidden="true"
            />
          </button>
        }
      >
        {/* ── New Chat button ──────────────────────────────────────── */}
        <button
          onClick={handleNewChat}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left',
            'hover:bg-[hsl(var(--foreground)/0.04)] text-[hsl(var(--foreground))]'
          )}
        >
          <SquarePen className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          {t('agentSidebar.newChat')}
        </button>

        <div className="my-1 h-px bg-[hsl(var(--border))]" role="separator" />

        {/* ── Sessions list ────────────────────────────────────────── */}
        <div className="max-h-[280px] overflow-y-auto">
          {agent.sessions.length === 0 ? (
            <p className="px-3 py-3 text-[11px] text-[hsl(var(--muted-foreground)/0.5)] text-center">
              {t('agentSidebar.noSessionsYet')}
            </p>
          ) : (
            agent.sessions.map((s) => (
              <SessionPickerItem
                key={s.id}
                session={s}
                isActive={s.id === agent.session?.id}
                onClick={() => handleSelectSession(s.id)}
              />
            ))
          )}
        </div>
      </PillDropdown>

      {/* ── Spacer ─────────────────────────────────────────────── */}
      <div className="flex-1" />

      {/* ── New chat icon button (always visible shortcut) ──────── */}
      <button
        onClick={handleNewChat}
        className={cn(
          'p-1 rounded-md transition-colors shrink-0',
          'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]'
        )}
        aria-label={t('agentSidebar.newChatAria')}
        title={t('agentSidebar.newChat')}
      >
        <SquarePen className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}

// ── Session picker item ─────────────────────────────────────────────

const SessionPickerItem = memo(function SessionPickerItem({
  session,
  isActive,
  onClick
}: {
  session: SessionSnapshot
  isActive: boolean
  onClick: () => void
}): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const messages = useSessionMessages(session.id)
  const title = sessionTitle(messages, t)

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-2 transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))]',
        isActive
          ? 'bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--foreground))]'
          : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] hover:text-[hsl(var(--foreground))]'
      )}
      aria-current={isActive ? 'true' : undefined}
    >
      <div className="flex items-start gap-2 min-w-0">
        <span
          className={cn('mt-1 w-1.5 h-1.5 rounded-full shrink-0', stateDotClass(session.state))}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs leading-snug line-clamp-2 break-words">{title}</p>
          <p className="text-[10px] text-[hsl(var(--muted-foreground)/0.5)] mt-0.5">
            {formatRelativeTime(session.lastActivity)}
          </p>
        </div>
      </div>
    </button>
  )
})

// ═══════════════════════════════════════════════════════════════════
// Body — Empty / Loading / Active
// ═══════════════════════════════════════════════════════════════════

function ChatPanelBody({ agent }: { agent: AgentSessionHandle }): React.JSX.Element {
  const { t } = useTranslation('sessions')

  // Empty state: no session and not starting
  if (!agent.session && !agent.isStarting) {
    return <ChatPanelEmpty onSend={agent.sendOrQueue} />
  }

  // Loading state: session is being created
  if (agent.isStarting && !agent.session) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[hsl(var(--muted-foreground))]">
        <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />
        <p className="text-xs">{t('agentChat.startingAgent')}</p>
      </div>
    )
  }

  if (!agent.session) return <></>

  return <ChatPanelActive agent={agent} />
}

// ── Empty State ─────────────────────────────────────────────────────

function ChatPanelEmpty({
  onSend
}: {
  onSend: (message: UserMessageContent) => Promise<boolean>
}): React.JSX.Element {
  const { t } = useTranslation('sessions')
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Centered prompt area */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 gap-3">
        <MessageSquare
          className="w-8 h-8 text-[hsl(var(--muted-foreground)/0.3)]"
          aria-hidden="true"
        />
        <p className="text-xs text-[hsl(var(--muted-foreground))] text-center">
          {t('agentChat.startConversation')}
        </p>
      </div>

      {/* Input at the bottom */}
      <div className="px-3 pb-3 pt-1 shrink-0">
        <ChatHeroInput onSend={onSend} registerAsChatTabInput />
      </div>
    </div>
  )
}

// ── Active Conversation ─────────────────────────────────────────────
// Reuses SessionChatLayout — the shared conversation layout that composes
// MessageList + StreamingFooter + TodoPill + QueuedMessages + ChatInput.
// ChatPanel only differs by having no max-width constraint on controls.

function ChatPanelActive({ agent }: { agent: AgentSessionHandle }): React.JSX.Element {
  const { t } = useTranslation('sessions')
  return (
    <SessionChatLayout
      session={agent.session!}
      onSendOrQueue={agent.sendOrQueue}
      onStop={agent.stop}
      messageQueue={agent.messageQueue}
      isProcessing={agent.isProcessing}
      isPaused={agent.isPaused}
      controlsMaxW={null}
      controlsClassName="px-3"
      pausedPlaceholder={t('agentChat.continueConversation')}
      sessionDraftFooterConfig={{
        strategy: 'lifecycle-tool-result-only',
      }}
      registerAsChatTabInput
    />
  )
}
