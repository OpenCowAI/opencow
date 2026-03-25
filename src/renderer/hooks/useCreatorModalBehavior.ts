// SPDX-License-Identifier: Apache-2.0

/**
 * useCreatorModalBehavior — Headless hook for AI Creator modal behavior.
 *
 * Encapsulates the shared lifecycle logic that all single-panel Creator modals
 * (Issue, Schedule, Bot) repeat identically:
 *   - Enter/exit animation (via `useModalAnimation`)
 *   - Unmount cleanup (ref-based, survives unmount)
 *   - Escape-key handler
 *   - Unsaved-work guard (discard confirmation dialog state)
 *
 * Domain modals compose this hook with their domain-specific session hook
 * and `CreatorModalShell` to produce a complete modal with minimal code.
 *
 * @module
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useModalAnimation } from '@/hooks/useModalAnimation'

// ── Config ──────────────────────────────────────────────────────────

export interface CreatorModalBehaviorConfig {
  /** Whether the modal is open. */
  open: boolean
  /** Called when the modal should close (after cleanup). */
  onClose: () => void
  /** Async cleanup function (typically: stop + delete session). */
  cleanup: () => Promise<void>
  /**
   * A stable identity key derived from the current parsed output.
   * `null` when no output exists — means nothing to guard.
   */
  outputKey: string | null
  /** Whether a live session exists. Combined with `outputKey` for unsaved-work detection. */
  hasSession: boolean
}

// ── Handle ──────────────────────────────────────────────────────────

export interface CreatorModalBehaviorHandle {
  /** Whether the modal DOM should be mounted (accounts for exit animation). */
  mounted: boolean
  /** Current animation phase (`'enter'`, `'exit'`, or `null`). */
  phase: 'enter' | 'exit' | null
  /** Whether the parsed output has changed since the last successful creation. */
  hasUnsavedWork: boolean
  /** Whether the discard-confirmation dialog is visible. */
  showDiscardConfirm: boolean
  /** Request close — shows discard dialog if there's unsaved work, otherwise closes. */
  handleCloseRequest: () => void
  /** Confirm close — cleanup + close (called from discard dialog "confirm"). */
  handleConfirmClose: () => Promise<void>
  /** Cancel close — dismiss the discard dialog. */
  handleCancelClose: () => void
  /**
   * Mark the current parsed output as "confirmed" (i.e. successfully created).
   * This clears the unsaved-work flag for the current output so the user
   * can close without a discard prompt.
   */
  markConfirmed: () => void
}

// ── Hook ────────────────────────────────────────────────────────────

export function useCreatorModalBehavior(
  config: CreatorModalBehaviorConfig
): CreatorModalBehaviorHandle {
  const { open, onClose, cleanup, outputKey, hasSession } = config

  // ── Animation ─────────────────────────────────────────────────
  const { mounted, phase } = useModalAnimation(open)

  // ── Unmount cleanup — ref survives unmount ────────────────────
  const cleanupRef = useRef(cleanup)
  useEffect(() => {
    cleanupRef.current = cleanup
  }, [cleanup])

  useEffect(() => {
    return () => {
      cleanupRef.current()
    }
  }, [])

  // ── Unsaved-work guard ────────────────────────────────────────
  const [confirmedOutputKey, setConfirmedOutputKey] = useState<string | null>(null)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)

  const hasUnsavedWork = hasSession && outputKey !== null && outputKey !== confirmedOutputKey

  const handleConfirmClose = useCallback(async () => {
    setShowDiscardConfirm(false)
    await cleanup()
    onClose()
  }, [cleanup, onClose])

  const handleCloseRequest = useCallback(() => {
    if (hasUnsavedWork) {
      setShowDiscardConfirm(true)
    } else {
      handleConfirmClose()
    }
  }, [hasUnsavedWork, handleConfirmClose])

  const handleCancelClose = useCallback(() => {
    setShowDiscardConfirm(false)
  }, [])

  const markConfirmed = useCallback(() => {
    setConfirmedOutputKey(outputKey)
  }, [outputKey])

  // ── Escape key ────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        handleCloseRequest()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, handleCloseRequest])

  return {
    mounted,
    phase,
    hasUnsavedWork,
    showDiscardConfirm,
    handleCloseRequest,
    handleConfirmClose,
    handleCancelClose,
    markConfirmed
  }
}
