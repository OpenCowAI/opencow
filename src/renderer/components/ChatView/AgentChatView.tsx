// SPDX-License-Identifier: Apache-2.0

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles, Loader2, Layers, FolderGit2 } from 'lucide-react'
import { ChatHeroInput } from './ChatHeroInput'
import { SessionChatLayout } from './SessionChatLayout'
import { ProjectScopeProvider } from '@/contexts/ProjectScopeContext'
import { cn } from '@/lib/utils'
import type { AgentSessionHandle } from '@/hooks/useAgentSession'
import type { UserMessageContent } from '@shared/types'

/**
 * Shared max-width for the centered conversation column.
 * Used by both EmptyChat (hero landing) and ActiveChat (message stream)
 * to ensure visual continuity when transitioning between states.
 */
const CONTENT_MAX_W = 'max-w-[640px]'

// ════════════════════════════════════════════════════════════════════
// AgentChatView — Root
// ════════════════════════════════════════════════════════════════════

interface AgentChatViewProps {
  /** Agent session handle — owned by the parent ChatView. */
  agent: AgentSessionHandle
}

/**
 * AgentChatView — Chat interface for direct Agent conversations.
 *
 * Receives its `AgentSessionHandle` from the parent `ChatView`, which is the
 * single owner of `useAgentSession()`. This avoids duplicate hook instances
 * (and the resulting double auto-dispatch in `useMessageQueue`).
 *
 * Both the empty landing and active conversation are laid out as a centered
 * content column with the same max-width, ensuring visual continuity.
 */
export function AgentChatView({ agent }: AgentChatViewProps): React.JSX.Element {
  const { t } = useTranslation('sessions')

  // ─── Render ───────────────────────────────────────────────────────

  let content: React.JSX.Element

  if (!agent.session && !agent.isStarting) {
    content = (
      <ProjectScopeProvider projectPath={agent.projectPath} projectId={agent.projectId ?? undefined}>
        <EmptyChat
          key={agent.projectPath ?? '__all__'}
          onSend={agent.sendOrQueue}
          projectName={agent.projectName}
        />
      </ProjectScopeProvider>
    )
  } else if (agent.isStarting && !agent.session) {
    content = (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[hsl(var(--muted-foreground))]">
        <Loader2 className="w-5 h-5 motion-safe:animate-spin" aria-hidden="true" />
        <p className="text-sm">{t('agentChat.startingAgent')}</p>
      </div>
    )
  } else if (!agent.session) {
    content = <></>
  } else {
    content = (
      <ProjectScopeProvider projectPath={agent.projectPath} projectId={agent.projectId ?? undefined}>
        <SessionChatLayout
          session={agent.session}
          onSendOrQueue={agent.sendOrQueue}
          onStop={agent.stop}
          messageQueue={agent.messageQueue}
          isProcessing={agent.isProcessing}
          isPaused={agent.isPaused}
          controlsMaxW={CONTENT_MAX_W}
          pausedPlaceholder={t('agentChat.continueConversation')}
          registerAsChatTabInput
        />
      </ProjectScopeProvider>
    )
  }

  return <div className="flex-1 flex flex-col min-h-0">{content}</div>
}

// ════════════════════════════════════════════════════════════════════
// ContextScopeBadge — Pill badge showing current scope
// ════════════════════════════════════════════════════════════════════

function ContextScopeBadge({ projectName }: { projectName: string | null }): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const isGlobal = !projectName
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium select-none',
        isGlobal
          ? 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'
          : 'bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--primary))]'
      )}
    >
      {isGlobal ? (
        <Layers className="w-3 h-3" aria-hidden="true" />
      ) : (
        <FolderGit2 className="w-3 h-3" aria-hidden="true" />
      )}
      {isGlobal ? t('agentChat.allProjects') : projectName}
    </span>
  )
}

// ════════════════════════════════════════════════════════════════════
// SuggestionChips — Quick-action suggestion buttons
// ════════════════════════════════════════════════════════════════════

const GLOBAL_SUGGESTION_KEYS = ['explainCodebase', 'helpDebug', 'writeFeature'] as const
const PROJECT_SUGGESTION_KEYS = ['summarizeProject', 'findBugs', 'suggestImprovements'] as const

function SuggestionChips({
  isGlobal,
  onSelect
}: {
  isGlobal: boolean
  onSelect: (text: string) => void
}): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const keys = isGlobal ? GLOBAL_SUGGESTION_KEYS : PROJECT_SUGGESTION_KEYS
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {keys.map((key) => {
        const label = t(`agentChat.suggestions.${key}`)
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(label)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs border transition-colors',
              'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]',
              'hover:border-[hsl(var(--foreground)/0.2)] hover:text-[hsl(var(--foreground))]',
              'hover:bg-[hsl(var(--foreground)/0.02)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]'
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// EmptyChat — Hero Landing (centered, context-aware)
// ════════════════════════════════════════════════════════════════════

function EmptyChat({
  onSend,
  projectName
}: {
  onSend: (message: UserMessageContent) => Promise<boolean>
  projectName: string | null
}): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const isGlobal = !projectName

  const placeholder = isGlobal
    ? t('agentChat.askAnythingGlobal')
    : t('agentChat.askAboutProject', { projectName })

  const handleSuggestion = useCallback(
    (text: string) => {
      onSend(text)
    },
    [onSend]
  )

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 pb-16">
      <div className={cn('w-full flex flex-col items-center gap-8', CONTENT_MAX_W)}>
        {/* Branding */}
        <div className="flex flex-col items-center gap-3 select-none">
          <div
            className={cn(
              'w-11 h-11 rounded-2xl flex items-center justify-center shadow-sm bg-gradient-to-br',
              isGlobal
                ? 'from-[hsl(var(--accent))] to-[hsl(var(--muted))]'
                : 'from-[hsl(var(--primary)/0.15)] to-[hsl(var(--accent))]'
            )}
          >
            {isGlobal ? (
              <Sparkles className="w-5 h-5 text-[hsl(var(--foreground))]" aria-hidden="true" />
            ) : (
              <FolderGit2 className="w-5 h-5 text-[hsl(var(--primary))]" aria-hidden="true" />
            )}
          </div>
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] text-center flex flex-wrap items-center justify-center gap-x-1.5">
            {isGlobal ? (
              <>
                {t('agentChat.whatCanIHelp')}
                <ContextScopeBadge projectName={null} />
              </>
            ) : (
              <>
                {t('agentChat.whatCanIHelpIn')}
                <ContextScopeBadge projectName={projectName} />
                {'?'}
              </>
            )}
          </h2>
        </div>

        {/* Hero Input */}
        <div className="w-full">
          <ChatHeroInput onSend={onSend} placeholder={placeholder} registerAsChatTabInput />
        </div>

        {/* Suggestion Chips */}
        <SuggestionChips isGlobal={isGlobal} onSelect={handleSuggestion} />

        {/* Keyboard hint */}
        <p className="text-[11px] text-[hsl(var(--muted-foreground)/0.6)] select-none">
          <kbd className="px-1.5 py-0.5 rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-[10px] font-mono">
            {t('agentChat.enterToSend')}
          </kbd>
          {t('agentChat.toSend')}
          <kbd className="px-1.5 py-0.5 rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-[10px] font-mono">
            {t('agentChat.slashForCommands')}
          </kbd>
          {t('agentChat.forCommands')}
        </p>
      </div>
    </div>
  )
}
