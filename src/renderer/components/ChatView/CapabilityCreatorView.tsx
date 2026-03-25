// SPDX-License-Identifier: Apache-2.0

/**
 * CapabilityCreatorView — Base modal component for all AI Creators.
 *
 * Renders as a Portal-mounted modal overlay (90% viewport) with a two-panel layout:
 *   - Left: AI conversation (SessionChatLayout)
 *   - Right: Live preview (CapabilityPreviewPanel, slides in when output detected)
 *
 * Parameterized by `CapabilityCreatorConfig` to support skill, agent, command, rule.
 * Each scene-specific wrapper (SkillCreatorView, AgentCreatorView, etc.) provides
 * its own config object.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Loader2, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ChatHeroInput } from './ChatHeroInput'
import { SessionChatLayout } from './SessionChatLayout'
import { CapabilityPreviewPanel } from './CapabilityPreviewPanel'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useCapabilityCreatorSession } from '@/hooks/useCapabilityCreatorSession'
import { useModalAnimation } from '@/hooks/useModalAnimation'
import { useBlockBrowserView } from '@/hooks/useBlockBrowserView'
import { ProjectScopeProvider } from '@/contexts/ProjectScopeContext'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { surfaceProps } from '@/lib/surface'
import { cn } from '@/lib/utils'
import type { AICreatableCategory, ManagedCapabilityIdentifier, UserMessageContent } from '@shared/types'

// ═══════════════════════════════════════════════════════════════════
// Config interface — each scene-specific wrapper provides this
// ═══════════════════════════════════════════════════════════════════

export interface CapabilityCreatorConfig {
  /** Which category this creator targets */
  category: AICreatableCategory
  /** Icon rendered in header and empty state */
  icon: LucideIcon
  /** Tailwind text color class for the icon (e.g. 'text-violet-500') */
  iconColor: string
  /** CSS gradient for the empty-state branding box */
  iconGradient: string
  /** i18n key prefix — e.g. 'capabilityCreator.skill' */
  i18nPrefix: string
  /** Suggestion chip i18n keys (shown in empty state) */
  suggestionKeys: readonly string[]
}

// ═══════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════

/** Props shared by all scene-specific Creator wrappers (SkillCreatorView, etc.). */
export interface CapabilityCreatorExternalProps {
  /** Controls modal visibility. */
  open: boolean
  /** Called when the modal should close. */
  onClose: () => void
  /** Called after a capability is saved successfully. */
  onSaved: (identifier: ManagedCapabilityIdentifier) => void
}

interface CapabilityCreatorViewProps extends CapabilityCreatorExternalProps {
  config: CapabilityCreatorConfig
}

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

const CONTENT_MAX_W = 'max-w-[640px]'

// ═══════════════════════════════════════════════════════════════════
// CapabilityCreatorView — Modal Root
// ═══════════════════════════════════════════════════════════════════

export function CapabilityCreatorView({
  config,
  open,
  onClose,
  onSaved
}: CapabilityCreatorViewProps): React.JSX.Element | null {
  const { t } = useTranslation('sessions')
  const { mounted, phase } = useModalAnimation(open)
  useBlockBrowserView('capability-creator', open)
  const agent = useCapabilityCreatorSession(config.category)
  const [showDiscardDialog, setShowDiscardDialog] = useState(false)
  const [showPreview, setShowPreview] = useState(true)
  const cleanupRef = useRef(agent.cleanup)

  // Keep ref in sync so the unmount callback always calls the latest cleanup
  useEffect(() => {
    cleanupRef.current = agent.cleanup
  }, [agent.cleanup])

  // Clean up session on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current()
    }
  }, [])

  // Resolve project for ProjectScopeProvider
  const selectedProjectId = useAppStore(selectProjectId)
  const projects = useAppStore((s) => s.projects)
  const projectPath = useMemo(
    () => projects.find((p) => p.id === selectedProjectId)?.path,
    [projects, selectedProjectId]
  )

  // Auto-restore preview when AI produces a new/updated output
  const parsedOutputRef = useRef(agent.parsedOutput)
  useEffect(() => {
    if (agent.parsedOutput && agent.parsedOutput !== parsedOutputRef.current) {
      setShowPreview(true)
    }
    parsedOutputRef.current = agent.parsedOutput
  }, [agent.parsedOutput])

  const hasSession = agent.session !== null

  // ── Close guard ────────────────────────────────────────────────

  const requestClose = useCallback(() => {
    if (hasSession) {
      setShowDiscardDialog(true)
    } else {
      onClose()
    }
  }, [hasSession, onClose])

  const confirmClose = useCallback(async () => {
    setShowDiscardDialog(false)
    await agent.cleanup()
    onClose()
  }, [agent, onClose])

  // Keyboard: Escape to close
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        requestClose()
      }
    },
    [requestClose]
  )

  // ── Saved handler ─────────────────────────────────────────────

  const handleSaved = useCallback(
    async (identifier: ManagedCapabilityIdentifier) => {
      await agent.cleanup()
      onSaved(identifier)
      onClose()
    },
    [agent, onSaved, onClose]
  )

  // ── i18n helpers ──────────────────────────────────────────────

  const title = t(`${config.i18nPrefix}.title`)
  const subtitle = t(`${config.i18nPrefix}.subtitle`)
  const placeholder = t(`${config.i18nPrefix}.placeholder`)
  const startingText = t(`${config.i18nPrefix}.starting`)
  const continuePlaceholder = t(`${config.i18nPrefix}.continuePlaceholder`)

  // ── Render ────────────────────────────────────────────────────

  if (!mounted) return null

  const Icon = config.icon

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center overscroll-contain no-drag">
      {/* Backdrop — decorative only */}
      <div
        className={cn(
          'absolute inset-0 bg-black/50 surface-backdrop-isolate',
          phase === 'enter' && 'modal-overlay-enter',
          phase === 'exit' && 'modal-overlay-exit'
        )}
        aria-hidden="true"
      />

      {/* Modal shell */}
      <div
        className={cn(
          'relative z-10',
          'w-[min(1080px,calc(100vw-48px))] h-[min(88vh,calc(100vh-48px))]',
          phase === 'enter' && 'modal-content-enter',
          phase === 'exit' && 'modal-content-exit'
        )}
      >
        {/* Glass surface */}
        <div
          {...surfaceProps({ elevation: 'modal', color: 'card' })}
          className="absolute inset-0 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl pointer-events-none"
          aria-hidden="true"
        />

        {/* Content */}
        <div
          role="dialog"
          aria-label={title}
          aria-modal="true"
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          className="relative flex flex-col h-full rounded-2xl outline-none overscroll-contain overflow-hidden"
        >
          {/* ── Header ── */}
          <div className="flex items-center justify-between h-12 px-5 border-b border-[hsl(var(--border)/0.3)] shrink-0">
            <div className="flex items-center gap-2">
              <Icon className={cn('h-4 w-4', config.iconColor)} aria-hidden="true" />
              <h2 className="text-sm font-medium text-[hsl(var(--foreground))]">{title}</h2>
            </div>
            <button
              type="button"
              onClick={requestClose}
              className="p-1.5 rounded-lg hover:bg-[hsl(var(--foreground)/0.05)] transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            </button>
          </div>

          {/* ── Body: Chat + Preview panels ── */}
          <div className="flex-1 flex min-h-0">
            {/* Chat panel */}
            <div
              className={cn(
                'flex-1 min-w-0 flex flex-col min-h-0 transition-all duration-300',
                agent.parsedOutput && showPreview ? 'w-[60%]' : 'w-full'
              )}
            >
              <ProjectScopeProvider projectPath={projectPath} projectId={selectedProjectId ?? undefined}>
                {!agent.session && !agent.isStarting ? (
                  <CreatorEmptyState
                    config={config}
                    title={title}
                    subtitle={subtitle}
                    placeholder={placeholder}
                    onSend={agent.sendOrQueue}
                  />
                ) : agent.isStarting && !agent.session ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[hsl(var(--muted-foreground))]">
                    <Loader2 className="w-5 h-5 motion-safe:animate-spin" aria-hidden="true" />
                    <p className="text-sm">{startingText}</p>
                  </div>
                ) : agent.session ? (
                  <SessionChatLayout
                    session={agent.session}
                    onSendOrQueue={agent.sendOrQueue}
                    onStop={agent.stop}
                    messageQueue={agent.messageQueue}
                    isProcessing={agent.isProcessing}
                    isPaused={agent.isPaused}
                    controlsMaxW={CONTENT_MAX_W}
                    pausedPlaceholder={continuePlaceholder}
                  />
                ) : null}
              </ProjectScopeProvider>
            </div>

            {/* Preview panel — slides in from right */}
            {agent.parsedOutput && showPreview && (
              <div className="w-[40%] min-w-[300px] max-w-[420px] shrink-0 skill-preview-enter">
                <CapabilityPreviewPanel
                  category={config.category}
                  parsedOutput={agent.parsedOutput}
                  isProcessing={agent.isProcessing}
                  onSaved={handleSaved}
                  onClose={() => setShowPreview(false)}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Discard confirmation ── */}
      <ConfirmDialog
        open={showDiscardDialog}
        title={t(`${config.i18nPrefix}.unsavedTitle`)}
        message={t(`${config.i18nPrefix}.unsavedMessage`)}
        confirmLabel={t(`${config.i18nPrefix}.discard`)}
        variant="destructive"
        onConfirm={confirmClose}
        onCancel={() => setShowDiscardDialog(false)}
      />
    </div>,
    document.body
  )
}

// ═══════════════════════════════════════════════════════════════════
// CreatorEmptyState — Landing state with suggestions
// ═══════════════════════════════════════════════════════════════════

function CreatorEmptyState({
  config,
  title,
  subtitle,
  placeholder,
  onSend
}: {
  config: CapabilityCreatorConfig
  title: string
  subtitle: string
  placeholder: string
  onSend: (message: UserMessageContent) => Promise<boolean>
}): React.JSX.Element {
  const { t } = useTranslation('sessions')

  const handleSuggestion = useCallback(
    (text: string) => {
      onSend(text)
    },
    [onSend]
  )

  const Icon = config.icon

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 pb-12">
      <div className={cn('w-full flex flex-col items-center gap-8', CONTENT_MAX_W)}>
        {/* Branding */}
        <div className="flex flex-col items-center gap-3 select-none">
          <div
            className={cn(
              'w-11 h-11 rounded-2xl flex items-center justify-center shadow-sm',
              config.iconGradient
            )}
          >
            <Icon className={cn('w-5 h-5', config.iconColor)} aria-hidden="true" />
          </div>
          <div className="text-center space-y-1">
            <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">{title}</h2>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">{subtitle}</p>
          </div>
        </div>

        {/* Input */}
        <div className="w-full">
          <ChatHeroInput onSend={onSend} placeholder={placeholder} />
        </div>

        {/* Suggestion chips */}
        <div className="flex flex-wrap justify-center gap-2">
          {config.suggestionKeys.map((key) => {
            const label = t(`${config.i18nPrefix}.suggestions.${key}`)
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleSuggestion(label)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs border transition-colors',
                  'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]',
                  'hover:border-[hsl(var(--border)/0.6)] hover:bg-[hsl(var(--foreground)/0.03)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]'
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
