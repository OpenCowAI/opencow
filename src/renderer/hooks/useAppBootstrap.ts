// SPDX-License-Identifier: Apache-2.0

/**
 * useAppBootstrap — Unified application bootstrap hook.
 *
 * Replaces the old useDataBus hook by combining:
 *   1. Initial data loading (get-initial-state + supplementary IPCs)
 *   2. Real-time DataBus event subscription
 *   3. appReady signal for splash screen orchestration
 *
 * Architecture:
 *   - Called ONCE at the App level (not inside AppLayout)
 *   - Event subscription starts immediately on mount → zero event loss
 *   - appReady is set to true once the critical initial state has loaded
 *   - On error, appReady is still set to true (graceful degradation)
 *
 * @module
 */
import { useEffect } from 'react'
import { useAppStore } from '@/stores/appStore'
import { useIssueStore } from '@/stores/issueStore'
import { useCommandStore } from '@/stores/commandStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useBrowserOverlayStore, deriveSourceKey } from '@/stores/browserOverlayStore'
import { useTerminalOverlayStore } from '@/stores/terminalOverlayStore'
import { useScheduleStore } from '@/stores/scheduleStore'
import { useFileStore } from '@/stores/fileStore'
import { useTasksStore } from '@/stores/tasksStore'
import { useStatsStore } from '@/stores/statsStore'
import { useInboxStore } from '@/stores/inboxStore'
import { useNoteStore } from '@/stores/noteStore'
import { useMessagingStore } from '@/stores/messagingStore'
import { useGitStore } from '@/stores/gitStore'
import { useUpdateStore } from '@/stores/updateStore'
import { toast } from '@/lib/toast'
import type { DataBusEvent, SessionSnapshot, ManagedSessionMessage } from '@shared/types'
import { getOriginIssueId } from '@shared/types'
import { resolveLocale } from '@shared/i18n'
import { getAppAPI } from '@/windowAPI'
import { thumbnailCache } from '@/lib/thumbnailCache'
import { ensureBootstrapDataLoaded } from '@/lib/bootstrap/bootstrapCoordinator'
import { applyLocale } from '@/i18n'
import { fireAndForget } from '@/lib/asyncUtils'

/** Tool names that modify files on disk — used for file refresh detection. */
const FILE_MODIFYING_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit'])

// ── Split Write-Coalescing Buffers ──────────────────────────────────
//
// During active streaming the main process fires ~20 IPC events/sec for
// session messages and ~20/sec for metadata updates (token counts, activity).
//
// Messages and metadata are flushed on SEPARATE cadences:
//
//   Messages → rAF (~60fps): streaming text must appear without delay.
//     After Fix 20, only ONE self-subscribing AssistantMessage re-renders
//     per rAF frame (~0.5ms), not the full Virtuoso cascade.
//
//   Metadata → 500ms (~2fps): token counts, duration, and activity text
//     don't need 60fps.  Flushing at 500ms eliminates ~0.8ms/frame of
//     React work from StreamingOverlayContent and SessionStatusBar that
//     would otherwise fire on every rAF frame.
//
// Terminal events (session:idle, session:stopped, session:deleted) flush
// BOTH buffers immediately via _flushAll().

/** Latest metadata snapshot per session — last-write-wins deduplication. */
const _pendingMeta = new Map<string, SessionSnapshot>()
/** Accumulated messages per session within the current frame. */
const _pendingMsgs = new Map<string, ManagedSessionMessage[]>()
/** rAF handle for message flush — 0 means no flush is scheduled. */
let _msgRafId = 0
/** Timer handle for metadata flush — 0 means no flush is scheduled. */
let _metaTimerId = 0

/**
 * Metadata flush interval (ms).
 *
 * Token counts, duration, and activity text don't need 60fps updates —
 * the user can't perceive 16ms granularity in "1.2k tokens" or "12s".
 * Flushing at 500ms (~2fps) eliminates ~0.8ms/frame of React work from
 * StreamingOverlayContent and SessionStatusBar re-renders on the other
 * 29 out of 30 frames.
 */
const META_FLUSH_INTERVAL_MS = 500

function _scheduleMsgFlush(): void {
  if (_msgRafId !== 0) return
  _msgRafId = requestAnimationFrame(_flushPendingMessages)
}

function _scheduleMetaFlush(): void {
  if (_metaTimerId !== 0) return
  _metaTimerId = window.setTimeout(_flushPendingMeta, META_FLUSH_INTERVAL_MS)
}

function _flushPendingMessages(): void {
  if (_msgRafId !== 0) {
    cancelAnimationFrame(_msgRafId)
    _msgRafId = 0
  }

  const msgs = _pendingMsgs.size > 0 ? new Map(_pendingMsgs) : null
  _pendingMsgs.clear()
  if (!msgs) return

  // Single set() for all message updates — the ONLY Zustand mutation per
  // rAF frame during text-only streaming.  After Fix 20, only the single
  // self-subscribing AssistantMessage re-renders from this.
  useCommandStore.getState().batchAppendSessionMessages(msgs)
}

function _flushPendingMeta(): void {
  _metaTimerId = 0

  const meta = _pendingMeta.size > 0 ? new Map(_pendingMeta) : null
  _pendingMeta.clear()
  if (!meta) return

  // Single set() for all metadata updates.  Triggers re-render of
  // StreamingOverlayContent and SessionStatusBar (via useStreamingSessionMetrics).
  // At 500ms interval, this adds ~0.8ms of work only twice per second.
  useCommandStore.getState().batchUpsertManagedSessions(meta)
}

/**
 * Force-flush BOTH buffers immediately.
 *
 * Called by terminal event handlers (turn.result, assistant.final) to ensure
 * the final state is committed without waiting for the next rAF / timer.
 */
function _flushAll(): void {
  _flushPendingMessages()
  _flushPendingMeta()
}

/** Cancel any pending flushes and discard buffered events. */
function _cancelPendingFlush(): void {
  if (_msgRafId !== 0) {
    cancelAnimationFrame(_msgRafId)
    _msgRafId = 0
  }
  if (_metaTimerId !== 0) {
    clearTimeout(_metaTimerId)
    _metaTimerId = 0
  }
  _pendingMeta.clear()
  _pendingMsgs.clear()
}

export function useAppBootstrap(): void {
  useEffect(() => {
    // ── 1. Initial bootstrap data (single-flight) ───────────────────
    // Coordinator makes this idempotent under StrictMode double-mount.
    void ensureBootstrapDataLoaded()

    // ── 2. Real-time DataBus event subscription ──────────────────────
    // Started immediately — no gap between mount and subscription.
    const unsubscribe = getAppAPI()['on:opencow:event']((event: DataBusEvent) => {
      const s = useAppStore.getState()
      switch (event.type) {
        case 'sessions:updated':
          s.setProjects(event.payload.projects)
          s.setSessions(event.payload.sessions)
          break
        case 'issues:invalidated':
          fireAndForget(useIssueStore.getState().loadIssues(), 'DataBus.issues:invalidated.loadIssues')
          fireAndForget(useNoteStore.getState().loadNoteCountsByIssue(), 'DataBus.issues:invalidated.loadNoteCountsByIssue')
          fireAndForget(useIssueStore.getState().loadCustomLabels(), 'DataBus.issues:invalidated.loadCustomLabels')
          break
        case 'tasks:updated':
          useTasksStore.getState().setTasks(event.payload.sessionId, event.payload.tasks)
          break
        case 'stats:updated':
          useStatsStore.getState().setStats(event.payload)
          break
        case 'onboarding:status':
          s.setOnboarding(event.payload)
          break
        case 'inbox:updated':
          useInboxStore.getState().setInboxState(event.payload)
          break
        case 'command:session:created':
          useCommandStore.getState().upsertManagedSession(event.payload)
          break
        case 'command:session:updated': {
          // ── Buffered: metadata → commandStore (rAF-coalesced) ────────
          // session:updated carries metadata changes (state, cost, model).
          // Messages are delivered separately via command:session:message.
          // SessionSnapshot has no messages field — store directly.
          {
            _pendingMeta.set(event.payload.id, event.payload)
            _scheduleMetaFlush()
          }

          // ── Immediate side effects (cross-store, low frequency) ──────
          if (event.payload.state === 'streaming') {
            const issueId = getOriginIssueId(event.payload.origin)
            if (issueId) {
              const issue = useIssueStore.getState().issueById[issueId]
              if (issue && issue.status !== 'in_progress') {
                fireAndForget(useIssueStore.getState().updateIssue(issueId, { status: 'in_progress' as const }), 'DataBus.command:session:updated.updateIssue(status)')
              }
            }
          }
          // NOTE: Browser overlay no longer shadows session state/activity.
          // BrowserSheetChat and BrowserViewportEdge read directly from
          // commandStore.sessionById — the rAF-coalesced update above is
          // the single source of truth.
          break
        }
        case 'command:session:message': {
          // ── Buffered: message → commandStore (rAF-coalesced) ─────────
          {
            const sid = event.payload.sessionId
            let buf = _pendingMsgs.get(sid)
            if (!buf) { buf = []; _pendingMsgs.set(sid, buf) }
            buf.push(event.payload.message)
            _scheduleMsgFlush()
          }

          // NOTE: Browser overlay messages are no longer upserted into
          // browserOverlayStore — BrowserSheetChat now reads from the
          // canonical commandStore via useSessionMessages(agentSessionId).

          // ── File modification detection (tool_use → tool_result correlation) ──
          {
            const msg = event.payload.message
            const fs = useFileStore.getState()

            if (msg.role === 'assistant' && Array.isArray(msg.content)) {
              for (const block of msg.content) {
                if (
                  block.type === 'tool_use' &&
                  FILE_MODIFYING_TOOLS.has(block.name) &&
                  typeof (block.input as Record<string, unknown>)?.file_path === 'string'
                ) {
                  fs.trackPendingFileWrite(
                    block.id,
                    (block.input as Record<string, unknown>).file_path as string
                  )
                }
              }
            }

            if (msg.role === 'user' && Array.isArray(msg.content)) {
              for (const block of msg.content) {
                if (block.type === 'tool_result') {
                  const filePath = fs.resolvePendingFileWrite(block.toolUseId)
                  if (filePath) {
                    fs.markFileNeedsRefresh(filePath)
                  }
                }
              }
            }
          }
          break
        }
        case 'command:session:idle':
        case 'command:session:stopped': {
          // Terminal events — flush any buffered metadata so subsequent
          // reads against sessionById see the latest state.
          _flushAll()
          // State already synced by preceding command:session:updated event.
          // Both idle and stopped share the same side effects:
          //   1. Update linked issue's lastAgentActivityAt timestamp
          //   2. Mark all open editor files for refresh
          const ended = useCommandStore.getState().sessionById[event.payload.sessionId]
          if (ended) {
            const issueId = getOriginIssueId(ended.origin)
            if (issueId) {
              fireAndForget(useIssueStore.getState().updateIssue(issueId, { lastAgentActivityAt: Date.now() }), 'DataBus.command:session:stopped.updateIssue(lastAgentActivityAt)')
            }
          }
          useFileStore.getState().markAllOpenFilesNeedRefresh()
          break
        }
        case 'settings:updated': {
          useSettingsStore.getState().setSettings(event.payload)
          const newLocale = resolveLocale(
            event.payload.language,
            useSettingsStore.getState().systemLocale,
          )
          applyLocale(newLocale)
          break
        }
        case 'provider:status':
          useSettingsStore.getState().setProviderStatus({ status: event.payload })
          break
        case 'messaging:status':
          useMessagingStore.getState().upsertMessagingConnectionStatus({ status: event.payload })
          break
        case 'command:session:deleted': {
          // Flush any buffered writes for this session before removal.
          _flushAll()
          const deletedId = event.payload.sessionId
          useCommandStore.getState().removeManagedSession(deletedId)
          if (s.agentChatSessionId === deletedId) {
            useAppStore.setState({ agentChatSessionId: null })
          }
          {
            const bs = useBrowserOverlayStore.getState()
            // Clean up persisted session from _sourceSessionMap
            bs.removeSourceSession(deletedId)
            if (bs.browserOverlay?.agentSessionId === deletedId) {
              bs.closeBrowserOverlay()
            }
          }
          break
        }
        case 'command:session:error': {
          // State already synced by preceding command:session:updated event.
          // Error is available via commandStore.sessionById[id].error —
          // browser overlay reads from there directly.
          break
        }
        case 'tray:navigate-issue': {
          const { issueId, projectId } = event.payload
          s.navigateToIssue(projectId, issueId)
          break
        }
        case 'schedule:created': {
          const { schedule } = event.payload
          useScheduleStore.setState((prev) => {
            if (prev.schedules.some((sc) => sc.id === schedule.id)) return prev
            return { schedules: [schedule, ...prev.schedules] }
          })
          break
        }
        case 'schedule:updated': {
          const { schedule } = event.payload
          useScheduleStore.setState((prev) => ({
            schedules: prev.schedules.map((sc) => (sc.id === schedule.id ? schedule : sc)),
          }))
          break
        }
        case 'schedule:deleted': {
          const { scheduleId } = event.payload
          useScheduleStore.setState((prev) => ({
            schedules: prev.schedules.filter((sc) => sc.id !== scheduleId),
          }))
          break
        }
        case 'schedule:executing': {
          break
        }
        case 'schedule:executed': {
          const { scheduleId, execution } = event.payload
          fireAndForget(useScheduleStore.getState().loadSchedules(), 'DataBus.schedule:executed.loadSchedules')
          useScheduleStore.setState((prev) => {
            const existing = prev.scheduleExecutions[scheduleId]
            if (!existing) return {}
            const idx = existing.findIndex((e) => e.id === execution.id)
            const next = idx >= 0
              ? existing.map((e) => (e.id === execution.id ? execution : e))
              : [execution, ...existing]
            return {
              scheduleExecutions: {
                ...prev.scheduleExecutions,
                [scheduleId]: next,
              },
            }
          })
          fireAndForget(useScheduleStore.getState().loadExecutions(scheduleId), 'DataBus.schedule:executed.loadExecutions')
          break
        }
        case 'schedule:paused': {
          const { scheduleId } = event.payload
          useScheduleStore.setState((prev) => ({
            schedules: prev.schedules.map((sc) =>
              sc.id === scheduleId ? { ...sc, status: 'paused' as const } : sc
            ),
          }))
          break
        }

        // ── Browser Overlay events (main process → renderer) ──

        case 'browser:open-overlay': {
          const { source, options } = event.payload as { source: import('@shared/types').BrowserSource; options?: import('@shared/types').BrowserOpenOptions }
          const bs = useBrowserOverlayStore.getState()
          if (bs.browserOverlay !== null) break
          // Per-source PiP guard: only block auto-reopen if THIS specific source
          // already has an active view (user explicitly minimized it to PiP).
          // A new session (different sourceKey) is allowed to auto-open BrowserSheet
          // even when other sessions have views alive in PiP.
          const incomingKey = deriveSourceKey(source)
          const sourceAlreadyActive = bs.activeBrowserSources.some(
            (as) => deriveSourceKey(as.source) === incomingKey
          )
          if (sourceAlreadyActive) break
          bs.openBrowserOverlay(source, options)
          break
        }

        case 'browser:close-overlay': {
          const bs = useBrowserOverlayStore.getState()
          bs.closeBrowserOverlay()
          break
        }

        case 'browser:view:opened': {
          const p = event.payload as { viewId: string; profileId: string; profileName: string }
          const bs = useBrowserOverlayStore.getState()
          bs.setBrowserOverlayViewId(p.viewId)
          bs.setBrowserOverlayActiveProfileId(p.profileId)
          bs.addActiveBrowserSource({
            source: bs.browserOverlay?.source ?? { type: 'standalone' },
            viewId: p.viewId,
            displayName: p.profileName,
          })
          break
        }

        case 'browser:view:closed': {
          const { viewId } = event.payload as { viewId: string }
          const bs = useBrowserOverlayStore.getState()

          if (bs.browserOverlay?.viewId === viewId) {
            // Clear viewId first — the view is already destroyed by the main process,
            // so closeBrowserOverlay() and finishBrowserSheetExit() should NOT attempt
            // to call browser:set-view-visible or browser:detach-view on it.
            bs.setBrowserOverlayViewId(null)
            // Trigger slide-out animation → finishBrowserSheetExit → browserOverlay = null
            bs.closeBrowserOverlay()
          }

          bs.removeActiveBrowserSource(viewId)
          bs.removeViewPageInfo(viewId)
          thumbnailCache.delete(viewId)
          break
        }

        case 'browser:navigated': {
          const nav = event.payload as { viewId: string; url: string; title: string }
          const bs = useBrowserOverlayStore.getState()
          bs.updateViewPageInfo(nav.viewId, { url: nav.url, title: nav.title })
          break
        }

        case 'browser:loading': {
          const load = event.payload as { viewId: string; isLoading: boolean }
          const bs = useBrowserOverlayStore.getState()
          if (load.viewId === bs.browserOverlay?.viewId) {
            bs.setBrowserOverlayIsLoading(load.isLoading)
          }
          bs.updateViewPageInfo(load.viewId, { isLoading: load.isLoading })
          break
        }

        case 'browser:executor:state-changed': {
          const exec = event.payload as { viewId: string; state: import('@shared/types').BrowserExecutorState }
          const bs = useBrowserOverlayStore.getState()
          if (exec.viewId === bs.browserOverlay?.viewId) {
            bs.setBrowserOverlayExecutorState(exec.state)
          }
          break
        }

        case 'browser:command:started': {
          const cmd = event.payload as { viewId: string; action: string }
          const bs = useBrowserOverlayStore.getState()
          if (cmd.viewId === bs.browserOverlay?.viewId) {
            bs.setBrowserOverlayCurrentAction(cmd.action)
          }
          break
        }

        case 'browser:command:completed': {
          const cmd = event.payload as { viewId: string; action: string; success: boolean }
          const bs = useBrowserOverlayStore.getState()
          if (cmd.viewId === bs.browserOverlay?.viewId) {
            bs.setBrowserOverlayCurrentAction(null)
          }
          break
        }

        case 'browser:thumbnail-updated': {
          const { viewId, dataUrl } = event.payload as { viewId: string; dataUrl: string }
          thumbnailCache.set(viewId, dataUrl)
          break
        }

        // ── Terminal events ──

        case 'terminal:exited': {
          const { id } = event.payload
          const ts = useTerminalOverlayStore.getState()
          const groups = ts.terminalTabGroups
          for (const [scopeKey, group] of Object.entries(groups)) {
            if (group.tabs.some((t) => t.terminalId === id)) {
              ts.removeTerminalTab(scopeKey, id)
              break
            }
          }
          break
        }

        // ── Git events ──

        case 'git:status-changed': {
          const { projectPath, snapshot } = event.payload
          useGitStore.getState().setGitStatus(projectPath, snapshot)
          break
        }

        // ── Update checker events ──

        case 'update:check-result': {
          useUpdateStore.getState().onCheckResult(event.payload)
          break
        }

        // ── UI-only events (main → renderer) ──

        case 'ui:toast': {
          const { message, duration } = event.payload
          toast(message, { duration })
          break
        }

        case 'menu:about': {
          s.openAboutDialog()
          break
        }
      }
    })

    return () => {
      unsubscribe()
      _cancelPendingFlush()
    }
  }, [])
}
