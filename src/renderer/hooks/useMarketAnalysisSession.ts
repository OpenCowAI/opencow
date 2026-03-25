// SPDX-License-Identifier: Apache-2.0

/**
 * useMarketAnalysisSession — Session-based marketplace analysis hook.
 *
 * Replaces the old black-box analysis (useMarketAnalyze + useMarketAnalyzeProgress)
 * with a visible Session Console experience. The user sees real-time AI conversation,
 * tool calls, and reasoning — and can intervene, guide, or correct the AI.
 *
 * Built on `useSessionBase` for shared session lifecycle infrastructure.
 * Listens for `market:analysis:complete` DataBus events to capture the result.
 *
 * @module
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useCommandStore } from '@/stores/commandStore'
import { deleteSession } from '@/actions/commandActions'
import { useSessionBase } from '@/hooks/useSessionBase'
import type { UseMessageQueueReturn } from '@/hooks/useMessageQueue'
import { getAppAPI } from '@/windowAPI'
import type {
  SessionSnapshot,
  MarketInstallPreview,
  MarketplaceId,
  DataBusEvent,
  UserMessageContent,
} from '@shared/types'

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface UseMarketAnalysisSessionResult {
  /** The managed session (for SessionChatLayout). Null before startAnalysis. */
  session: SessionSnapshot | null
  /** Whether analysis has been started (session creation in flight or active). */
  isAnalyzing: boolean
  /** Whether the session is actively processing (streaming). */
  isProcessing: boolean
  /** Whether the session is paused (idle/stopped/error). */
  isPaused: boolean
  /** Start analysis for a given slug. Returns when session is created. */
  startAnalysis: (slug: string, marketplaceId: MarketplaceId) => Promise<void>
  /** Cancel the current analysis (stops the session). */
  cancel: () => void
  /** Send a message to the analysis session (user intervention). */
  sendOrQueue: (message: UserMessageContent) => Promise<boolean>
  /** Message queue handle (for SessionChatLayout). */
  messageQueue: UseMessageQueueReturn
  /** Stop handler (for SessionChatLayout). */
  onStop: () => void
  /** Analysis result (available after session completes via DataBus). */
  preview: MarketInstallPreview | null
  /** Error if analysis failed. */
  error: string | null
  /** Reset all state (call when dialog closes or re-opening). */
  reset: () => void
}

// ═══════════════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════════════

export function useMarketAnalysisSession(): UseMarketAnalysisSessionResult {
  const stopSession = useCommandStore((s) => s.stopSession)

  // ── Local session ID (ephemeral, not persisted) ─────────────
  const [sessionId, setSessionId] = useState<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)

  // Keep ref in sync for cleanup (ref survives unmount)
  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  const clearSessionId = useCallback(() => setSessionId(null), [])

  const base = useSessionBase({
    sessionId,
    onSessionIdClear: clearSessionId,
  })

  // ── Analysis-specific state ─────────────────────────────────
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [preview, setPreview] = useState<MarketInstallPreview | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Track current slug for DataBus event filtering
  const slugRef = useRef<string | null>(null)

  // ── Listen for DataBus analysis:complete event ──────────────
  useEffect(() => {
    const unsub = getAppAPI()['on:opencow:event']((event: DataBusEvent) => {
      if (event.type !== 'market:analysis:complete') return
      // Filter by current session or slug
      if (
        event.payload.sessionId !== sessionIdRef.current &&
        event.payload.slug !== slugRef.current
      ) {
        return
      }

      if (event.payload.error) {
        setError(event.payload.error)
      }
      if (event.payload.preview) {
        setPreview(event.payload.preview)
      }
      setIsAnalyzing(false)
    })

    return unsub
  }, [])

  // ── Start analysis ──────────────────────────────────────────
  const startAnalysis = useCallback(
    async (slug: string, marketplaceId: MarketplaceId) => {
      // Reset previous state
      setPreview(null)
      setError(null)
      setIsAnalyzing(true)
      slugRef.current = slug

      try {
        const result = await getAppAPI()['market:start-analysis-session'](slug, marketplaceId)
        setSessionId(result.sessionId)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start analysis')
        setIsAnalyzing(false)
      }
    },
    [],
  )

  // ── Send / queue message to the analysis session ────────────
  const sendOrQueue = useCallback(
    async (message: UserMessageContent): Promise<boolean> => {
      return base.sendOrQueueExisting(message)
    },
    [base],
  )

  // ── Cancel analysis ─────────────────────────────────────────
  const cancel = useCallback(() => {
    base.handleStop()
    setIsAnalyzing(false)
  }, [base])

  // ── Reset (dialog close / re-open) ──────────────────────────
  const reset = useCallback(async () => {
    const id = sessionIdRef.current
    if (id) {
      try {
        await stopSession(id)
      } catch {
        // Session may already be stopped
      }
      try {
        await deleteSession(id)
      } catch {
        // Session may already be deleted
      }
    }
    setSessionId(null)
    setPreview(null)
    setError(null)
    setIsAnalyzing(false)
    slugRef.current = null
  }, [stopSession])

  // ── Cleanup on unmount ──────────────────────────────────────
  useEffect(() => {
    return () => {
      const id = sessionIdRef.current
      if (id) {
        stopSession(id).catch(() => {})
        deleteSession(id).catch(() => {})
      }
    }
  }, [stopSession])

  // ── Return ──────────────────────────────────────────────────
  return {
    session: base.session,
    isAnalyzing,
    isProcessing: base.isProcessing,
    isPaused: base.isPaused,
    startAnalysis,
    cancel,
    sendOrQueue,
    messageQueue: base.messageQueue,
    onStop: base.handleStop,
    preview,
    error,
    reset,
  }
}
