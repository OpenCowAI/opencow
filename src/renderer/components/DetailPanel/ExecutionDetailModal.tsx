// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  X, ChevronLeft,
  MessageSquare,
} from 'lucide-react'
import { useExitAnimation, useModalAnimation } from '@/hooks/useModalAnimation'
import { useBlockBrowserView } from '@/hooks/useBlockBrowserView'
import { useAppStore } from '@/stores/appStore'
import { useCommandStore } from '@/stores/commandStore'
import { useScheduleStore } from '@/stores/scheduleStore'
import { cn } from '@/lib/utils'
import { SessionPanel } from './SessionPanel/SessionPanel'
import type { SessionPanelCapabilities } from './SessionPanel/SessionPanel'
import { ProjectScopeProvider } from '@/contexts/ProjectScopeContext'
import type { ScheduleExecution, Schedule } from '@shared/types'

// ─── Props ────────────────────────────────────────────────────────────────────

interface ExecutionDetailModalProps {
  execution: ScheduleExecution
  onClose: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDatetime(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60_000)
  const secs = Math.round((ms % 60_000) / 1000)
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

function formatOffset(base: number, ts: number): string {
  const diff = ts - base
  if (diff < 1000) return '+0s'
  if (diff < 60_000) return `+${Math.round(diff / 1000)}s`
  const mins = Math.floor(diff / 60_000)
  const secs = Math.round((diff % 60_000) / 1000)
  return secs > 0 ? `+${mins}m ${secs}s` : `+${mins}m`
}

// ─── Status style maps ────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  success:   'bg-green-500/10 text-green-500',
  failed:    'bg-red-500/10 text-red-500',
  running:   'bg-blue-500/10 text-blue-500',
  timeout:   'bg-orange-500/10 text-orange-500',
  skipped:   'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
  cancelled: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
}

const STATUS_DOT: Record<string, string> = {
  success:   'bg-green-500',
  failed:    'bg-red-500',
  running:   'bg-blue-500 animate-pulse',
  timeout:   'bg-orange-500',
  skipped:   'bg-[hsl(var(--muted-foreground))]',
  cancelled: 'bg-[hsl(var(--muted-foreground))]',
}

// ─── SessionFullView ──────────────────────────────────────────────────────────

/**
 * Renders the full session experience for a schedule execution.
 *
 * Local transcript fallback was removed with SessionSource.
 * Detail is available only while the managed session is present in runtime state.
 */
function SessionFullView({
  sessionId,
  scheduleData,
}: {
  sessionId: string
  scheduleData: Schedule | undefined
}): React.JSX.Element {
  const { t } = useTranslation('schedule')

  // ── Primary source: managed session (created by SessionOrchestrator) ──
  const managedSession = useCommandStore((s) =>
    s.sessionById[sessionId]
  )
  const projects  = useAppStore((s) => s.projects)

  // Real store actions — same pattern as IssueDetailView
  const storeStop    = useCommandStore((s) => s.stopSession)
  const storeSend    = useCommandStore((s) => s.sendMessage)
  const storeResume  = useCommandStore((s) => s.resumeSession)

  const projectPath = useMemo(() => {
    const pid = scheduleData?.action?.projectId
    return pid ? projects.find((p) => p.id === pid)?.path : undefined
  }, [scheduleData?.action?.projectId, projects])

  const capabilities = useMemo<SessionPanelCapabilities>(() => ({
    stop:   () => { void storeStop(sessionId) },
    send:   (msg) => storeSend(sessionId, msg),
    resume: (msg) => storeResume(sessionId, msg),
  }), [sessionId, storeStop, storeSend, storeResume])

  // ── Render: managed session → full interactive SessionPanel ──
  if (managedSession) {
    return (
      <ProjectScopeProvider projectPath={projectPath} projectId={scheduleData?.action?.projectId}>
        <SessionPanel
          binding={{ kind: 'session', sessionId }}
          lifecycle="active"
          isStarting={false}
          capabilities={capabilities}
        />
      </ProjectScopeProvider>
    )
  }
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 px-8 text-center">
      <MessageSquare className="h-7 w-7 text-[hsl(var(--muted-foreground)/0.35)]" aria-hidden="true" />
      <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed max-w-[280px]">
        {t('executionDetail.sessionNotInStoreDesc')}
      </p>
      <p className="text-[11px] text-[hsl(var(--muted-foreground)/0.75)]">
        {t('executionDetail.managedOnlyHint', {
          defaultValue: 'Session preview is available only while the managed runtime session is active.',
        })}
      </p>
    </div>
  )
}

// ─── ExecutionDetailModal ─────────────────────────────────────────────────────

export function ExecutionDetailModal({
  execution,
  onClose,
}: ExecutionDetailModalProps): React.JSX.Element {
  const { t } = useTranslation('schedule')
  useBlockBrowserView('execution-detail-modal', true)
  const { phase, requestClose } = useExitAnimation(onClose)
  const [sessionViewOpen, setSessionViewOpen] = useState(false)
  const { mounted: sessionViewMounted, phase: sessionViewPhase } = useModalAnimation(sessionViewOpen)

  const scheduleData = useScheduleStore((s) => s.schedules.find((sc) => sc.id === execution.scheduleId))
  const showUsage = execution.costUsd > 0 || execution.inputTokens > 0 || execution.outputTokens > 0

  const handleViewSession = useCallback(() => {
    if (execution.sessionId) setSessionViewOpen(true)
  }, [execution.sessionId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center no-drag"
      role="dialog"
      aria-modal="true"
      aria-label={t('executionDetail.title')}
    >
      {/* Backdrop */}
      <div
        className={cn(
          'absolute inset-0 bg-black/50',
          phase === 'enter' && 'modal-overlay-enter',
          phase === 'exit'  && 'modal-overlay-exit'
        )}
        onClick={requestClose}
        aria-hidden="true"
      />

      {/* Execution detail panel */}
      <div
        className={cn(
          'relative z-10 bg-[hsl(var(--background))] border border-[hsl(var(--border))]',
          'rounded-2xl shadow-xl w-full max-w-[480px] mx-4 flex flex-col max-h-[85vh] overflow-hidden',
          phase === 'enter' && 'modal-content-enter',
          phase === 'exit'  && 'modal-content-exit'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className={cn('w-2 h-2 rounded-full shrink-0', STATUS_DOT[execution.status] ?? 'bg-[hsl(var(--muted-foreground))]')} />
            <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full shrink-0', STATUS_BADGE[execution.status] ?? 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]')}>
              {t(`executionStatus.${execution.status}`, { defaultValue: execution.status })}
            </span>
            <span className="text-xs text-[hsl(var(--muted-foreground))] truncate">
              {t(`triggerType.${execution.triggerType}`, { defaultValue: execution.triggerType })}
            </span>
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="ml-2 shrink-0 p-1 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.06)] transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto overscroll-contain divide-y divide-[hsl(var(--border)/0.5)]">

          <section className="px-5 py-4">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-3">
              {t('executionDetail.timeline')}
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-[hsl(var(--muted-foreground))] shrink-0">{t('executionDetail.scheduled')}</span>
                <span className="font-mono text-right">{formatDatetime(execution.scheduledAt)}</span>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-[hsl(var(--muted-foreground))] shrink-0">{t('executionDetail.started')}</span>
                <span className="font-mono text-right">
                  {formatDatetime(execution.startedAt)}{' '}
                  <span className="text-[hsl(var(--muted-foreground))]">{formatOffset(execution.scheduledAt, execution.startedAt)}</span>
                </span>
              </div>
              {execution.completedAt != null && (
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[hsl(var(--muted-foreground))] shrink-0">{t('executionDetail.completed')}</span>
                  <span className="font-mono text-right">
                    {formatDatetime(execution.completedAt)}{' '}
                    <span className="text-[hsl(var(--muted-foreground))]">{formatOffset(execution.startedAt, execution.completedAt)}</span>
                  </span>
                </div>
              )}
              {execution.durationMs != null && (
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[hsl(var(--muted-foreground))] shrink-0">{t('executionDetail.duration')}</span>
                  <span className="font-mono font-medium">{formatDuration(execution.durationMs)}</span>
                </div>
              )}
            </div>
          </section>

          {execution.triggerDetail && (
            <section className="px-5 py-4">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-2">
                {t('executionDetail.triggerDetail')}
              </h3>
              <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">{execution.triggerDetail}</p>
            </section>
          )}

          <section className="px-5 py-4">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-2">
              {t('executionDetail.prompt')}
            </h3>
            {execution.resolvedPrompt ? (
              <pre className="text-xs font-mono bg-[hsl(var(--muted)/0.5)] rounded-xl px-3 py-2.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[hsl(var(--foreground)/0.85)] leading-relaxed">
                {execution.resolvedPrompt}
              </pre>
            ) : (
              <p className="text-xs text-[hsl(var(--muted-foreground))] italic">{t('executionDetail.noPrompt')}</p>
            )}
          </section>

          {execution.error && (
            <section className="px-5 py-4">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-red-500 mb-2">
                {t('executionDetail.error')}
              </h3>
              <pre className="text-xs font-mono bg-red-500/8 text-red-600 dark:text-red-400 rounded-xl px-3 py-2.5 max-h-32 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed">
                {execution.error}
              </pre>
            </section>
          )}

          {showUsage && (
            <section className="px-5 py-4">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-3">
                {t('executionDetail.usage')}
              </h3>
              <div className="grid grid-cols-3 gap-2.5">
                {[
                  { label: t('executionDetail.cost'),         value: `$${execution.costUsd.toFixed(4)}` },
                  { label: t('executionDetail.inputTokens'),  value: execution.inputTokens.toLocaleString() },
                  { label: t('executionDetail.outputTokens'), value: execution.outputTokens.toLocaleString() },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-[hsl(var(--muted)/0.4)] rounded-xl px-3 py-2.5 text-center">
                    <div className="text-xs font-semibold tabular-nums">{value}</div>
                    <div className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">{label}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[hsl(var(--border))] flex items-center justify-between gap-2">
          {execution.sessionId ? (
            <button
              type="button"
              onClick={handleViewSession}
              className="flex items-center gap-1.5 text-xs text-[hsl(var(--primary))] hover:opacity-75 transition-opacity"
            >
              <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
              {t('executionDetail.viewSession')}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={requestClose}
            className="text-xs px-3 py-1.5 rounded-lg bg-[hsl(var(--muted)/0.6)] hover:bg-[hsl(var(--muted))] transition-colors"
          >
            {t('executionDetail.close')}
          </button>
        </div>
      </div>

      {/* ── Session view overlay ── */}
      {sessionViewMounted && execution.sessionId && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center no-drag"
          role="dialog"
          aria-modal="true"
          aria-label={t('executionDetail.sessionPreviewTitle')}
        >
          <div
            className={cn(
              'absolute inset-0 bg-black/50',
              sessionViewPhase === 'enter' && 'modal-overlay-enter',
              sessionViewPhase === 'exit'  && 'modal-overlay-exit',
            )}
            onClick={() => setSessionViewOpen(false)}
            aria-hidden="true"
          />

          {/*
           * Session panel container — MUST use a definite height (h-[88vh]), NOT max-h.
           *
           * Reason: SessionPanel's root is `h-full flex flex-col`. For `height: 100%`
           * to resolve to a real pixel value, every ancestor in the flex chain needs a
           * definite height. A `max-h-only` container produces a height determined by
           * content, which makes SessionPanel's internal scrollable region collapse to
           * zero when messages are few, and prevents the message list from scrolling.
           *
           * Using `h-[88vh]` ensures the modal always occupies a fixed viewport fraction,
           * giving SessionPanel the definite ancestor height it requires.
           */}
          <div className={cn(
              'relative z-10 bg-[hsl(var(--background))] border border-[hsl(var(--border))]',
              'rounded-2xl shadow-2xl w-full max-w-[720px] mx-4 flex flex-col h-[88vh] overflow-hidden',
              sessionViewPhase === 'enter' && 'modal-content-enter',
              sessionViewPhase === 'exit'  && 'modal-content-exit',
            )}>
            {/* Header */}
            <div className="flex items-center px-4 py-2.5 border-b border-[hsl(var(--border))] shrink-0">
              <button
                type="button"
                onClick={() => setSessionViewOpen(false)}
                className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                {t('executionDetail.backToExecution')}
              </button>
              <span className="mx-auto text-xs font-semibold">
                {t('executionDetail.sessionPreviewTitle')}
              </span>
              {/* Spacer keeps title centred */}
              <span className="w-[100px]" aria-hidden="true" />
            </div>

            {/*
             * Content: flex-1 + min-h-0 so the flex item shrinks to fit inside h-[88vh]
             * rather than overflowing. SessionPanel's h-full then resolves correctly.
             */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <SessionFullView
                sessionId={execution.sessionId}
                scheduleData={scheduleData}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
