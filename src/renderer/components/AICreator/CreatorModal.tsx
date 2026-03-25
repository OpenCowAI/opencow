// SPDX-License-Identifier: Apache-2.0

/**
 * CreatorModal — High-level composition component for AI Creator modals.
 *
 * Eliminates the repeated composition pattern across Issue, Schedule, and
 * Bot Creator modals by wiring together:
 *   - `useCreatorModalBehavior` (animation, cleanup, discard guard)
 *   - `CreatorModalShell` (portal, backdrop, glass surface, header)
 *   - `ProjectScopeProvider` (ambient project context)
 *   - `SessionChatLayout` / `CreatorEmptyState` (conditional content)
 *
 * Domain modals only provide:
 *   - A session handle (from any `useXxxCreatorSession`)
 *   - An `outputKey` function for discard-guard comparison
 *   - Localized i18n strings
 *   - Optional `footerNode` and `extraPortals`
 *
 * @module
 */

import { useTranslation } from 'react-i18next'
import { useCreatorModalBehavior, type CreatorModalBehaviorHandle } from '@/hooks/useCreatorModalBehavior'
import { CreatorModalShell, type CreatorModalDiscardLabels } from './CreatorModalShell'
import { CreatorEmptyState } from './CreatorEmptyState'
import { SessionChatLayout } from '../ChatView/SessionChatLayout'
import { ProjectScopeProvider } from '@/contexts/ProjectScopeContext'
import type { CreatorSessionHandle } from '@/hooks/useCreatorSession'

// ── i18n Config ──────────────────────────────────────────────────────

/** Localized strings for the modal UI — grouped by area. */
export interface CreatorModalI18n {
  /** Header strings. */
  header: {
    title: string
    closeLabel: string
  }
  /** Discard-confirmation dialog strings. */
  discard: CreatorModalDiscardLabels
  /** Welcome screen strings (pre-conversation). */
  welcome: {
    title: string
    description: string
    inputPlaceholder: string
  }
  /** Paused input placeholder (in-conversation). */
  pausedPlaceholder: string
  /** Suggestion chips for the welcome screen. */
  suggestions: string[]
}

// ── Props ────────────────────────────────────────────────────────────

export interface CreatorModalProps<TParsed> {
  /** Controls modal visibility. */
  open: boolean
  /** Called when the modal should close. */
  onClose: () => void
  /** Domain session handle — from any `useXxxCreatorSession`. */
  creator: CreatorSessionHandle<TParsed>
  /**
   * Derive a stable identity key from parsed output for the discard guard.
   * Returns `null` when no output exists.
   */
  outputKey: (parsed: TParsed | null) => string | null
  /** Localized UI strings. */
  i18n: CreatorModalI18n
  /** Project context for `ProjectScopeProvider`. */
  project?: {
    id?: string
    path?: string
  }
  /** Footer node rendered below the chat (e.g. confirmation card). */
  footerNode?: React.ReactNode
  /**
   * Extra portals rendered as siblings in the body portal
   * (e.g. IssueFormModal, ScheduleFormModal).
   */
  extraPortals?: React.ReactNode
}

// ── Return type (exposes modal handle for markConfirmed) ─────────────

export interface CreatorModalHandle {
  /** Modal behavior handle — call `markConfirmed()` after successful creation. */
  modal: CreatorModalBehaviorHandle
}

// ── Component ────────────────────────────────────────────────────────

export function CreatorModal<TParsed>({
  open,
  onClose,
  creator,
  outputKey,
  i18n: strings,
  project,
  footerNode,
  extraPortals
}: CreatorModalProps<TParsed>): React.JSX.Element | null {
  // ── Modal behavior (animation, cleanup, discard guard, escape) ──
  const modal = useCreatorModalBehavior({
    open,
    onClose,
    cleanup: creator.cleanup,
    outputKey: outputKey(creator.parsedOutput),
    hasSession: creator.session !== null
  })

  return (
    <CreatorModalShell
      modal={modal}
      header={strings.header}
      discardLabels={strings.discard}
      extraPortals={extraPortals}
    >
      <ProjectScopeProvider projectPath={project?.path} projectId={project?.id}>
        {creator.session ? (
          <SessionChatLayout
            session={creator.session}
            onSendOrQueue={creator.sendOrQueue}
            onStop={creator.stop}
            messageQueue={creator.messageQueue}
            isProcessing={creator.isProcessing}
            isPaused={creator.isPaused}
            controlsMaxW={null}
            controlsClassName="px-3"
            pausedPlaceholder={strings.pausedPlaceholder}
            footerNode={footerNode}
          />
        ) : (
          <CreatorEmptyState
            isStarting={creator.isStarting}
            onSend={creator.sendOrQueue}
            welcomeTitle={strings.welcome.title}
            welcomeDescription={strings.welcome.description}
            inputPlaceholder={strings.welcome.inputPlaceholder}
            suggestions={strings.suggestions}
          />
        )}
      </ProjectScopeProvider>
    </CreatorModalShell>
  )
}

/**
 * Convenience re-export: `useCreatorModalBehavior` handle type.
 * Domain modals that need `markConfirmed()` can get it from the
 * `CreatorModal` ref pattern or by calling the hook directly.
 *
 * Note: Since `CreatorModal` encapsulates `useCreatorModalBehavior` internally,
 * domain modals that need `markConfirmed()` should call `useCreatorModalBehavior`
 * themselves and pass the handle to `CreatorModalControlled` instead.
 * See the controlled variant below.
 */

// ── Controlled variant (domain modal manages its own modal handle) ───

export interface CreatorModalControlledProps<TParsed> extends Omit<CreatorModalProps<TParsed>, 'open' | 'onClose' | 'outputKey'> {
  /** Pre-configured modal behavior handle from `useCreatorModalBehavior`. */
  modal: CreatorModalBehaviorHandle
}

/**
 * Controlled variant where the domain modal owns the `useCreatorModalBehavior`
 * handle — needed when the domain modal must call `modal.markConfirmed()`.
 */
export function CreatorModalControlled<TParsed>({
  modal,
  creator,
  i18n: strings,
  project,
  footerNode,
  extraPortals
}: CreatorModalControlledProps<TParsed>): React.JSX.Element | null {
  return (
    <CreatorModalShell
      modal={modal}
      header={strings.header}
      discardLabels={strings.discard}
      extraPortals={extraPortals}
    >
      <ProjectScopeProvider projectPath={project?.path} projectId={project?.id}>
        {creator.session ? (
          <SessionChatLayout
            session={creator.session}
            onSendOrQueue={creator.sendOrQueue}
            onStop={creator.stop}
            messageQueue={creator.messageQueue}
            isProcessing={creator.isProcessing}
            isPaused={creator.isPaused}
            controlsMaxW={null}
            controlsClassName="px-3"
            pausedPlaceholder={strings.pausedPlaceholder}
            footerNode={footerNode}
          />
        ) : (
          <CreatorEmptyState
            isStarting={creator.isStarting}
            onSend={creator.sendOrQueue}
            welcomeTitle={strings.welcome.title}
            welcomeDescription={strings.welcome.description}
            inputPlaceholder={strings.welcome.inputPlaceholder}
            suggestions={strings.suggestions}
          />
        )}
      </ProjectScopeProvider>
    </CreatorModalShell>
  )
}
