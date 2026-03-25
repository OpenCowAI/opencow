// SPDX-License-Identifier: Apache-2.0

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquareOff } from 'lucide-react'
import { useCommandStore, useSessionIdentity } from '@/stores/commandStore'
import { SessionPanel } from './SessionPanel/SessionPanel'
import type { SessionPanelCapabilities } from './SessionPanel/SessionPanel'
import { ProjectScopeProvider } from '@/contexts/ProjectScopeContext'

interface SessionDetailViewProps {
  sessionId: string
}

/**
 * Session detail now renders from managed session runtime state only.
 * Local ~/.claude transcript loading has been removed in favor of
 * normalized engine events.
 */
export function SessionDetailView({ sessionId }: SessionDetailViewProps): React.JSX.Element {
  const { t } = useTranslation('sessions')

  // Narrow identity selector — extracts only `id`, `projectPath`, `projectId`
  // from the matched session, compared with `shallow`.  During streaming the
  // selector runs on every store change, but the component skips re-render
  // because these identity fields are stable (session ID, project path, and
  // project ID never change for an existing session).
  const identity = useSessionIdentity(sessionId)
  const storeStop = useCommandStore((s) => s.stopSession)
  const storeSend = useCommandStore((s) => s.sendMessage)
  const storeResume = useCommandStore((s) => s.resumeSession)

  const resolvedId = identity?.id
  const capabilities = useMemo<SessionPanelCapabilities>(() => {
    return {
      stop: () => {
        if (!resolvedId) return
        void storeStop(resolvedId)
      },
      send: (msg) => {
        if (!resolvedId) return Promise.resolve(false)
        return storeSend(resolvedId, msg)
      },
      resume: (msg) => {
        if (!resolvedId) return Promise.resolve(false)
        return storeResume(resolvedId, msg)
      },
    }
  }, [resolvedId, storeStop, storeSend, storeResume])

  if (!identity) {
    return (
      <aside className="h-full flex flex-col items-center justify-center gap-3 px-8 text-center bg-[hsl(var(--card))]">
        <MessageSquareOff className="h-7 w-7 text-[hsl(var(--muted-foreground)/0.4)]" aria-hidden="true" />
        <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed max-w-[320px]">
          {t('sessionDetail.unavailableManagedOnly', {
            defaultValue: 'This session is not available in managed runtime state.',
          })}
        </p>
      </aside>
    )
  }

  return (
    <aside className="h-full bg-[hsl(var(--card))]" aria-label="Session detail">
      <ProjectScopeProvider
        projectPath={identity.projectPath ?? undefined}
        projectId={identity.projectId ?? undefined}
      >
        <SessionPanel
          binding={{ kind: 'session', sessionId: identity.id }}
          lifecycle="active"
          isStarting={false}
          capabilities={capabilities}
        />
      </ProjectScopeProvider>
    </aside>
  )
}
