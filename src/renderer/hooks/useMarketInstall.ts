// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useRef } from 'react'
import type { MarketInstallResult, MarketplaceId } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

// ─── Step types ─────────────────────────────────────────────

export type InstallStepStatus = 'pending' | 'active' | 'done' | 'error'

export interface InstallStep {
  id: string
  label: string
  status: InstallStepStatus
}

export interface InstallProgress {
  steps: InstallStep[]
  currentStepIndex: number
  errorMessage?: string
}

// ─── Step definitions ───────────────────────────────────────

const SKILL_STEP_DEFS = [
  { id: 'download', label: 'Downloading skill bundle' },
  { id: 'verify', label: 'Verifying SKILL.md' },
  { id: 'extract', label: 'Extracting files' },
  { id: 'install', label: 'Installing to workspace' },
  { id: 'complete', label: 'Installation complete' },
]

/** Cascade interval between steps on success (ms). */
const CASCADE_INTERVAL = 100

// ─── Error → Step mapping ────────────────────────────────────

const STEP_ERROR_PATTERNS: Record<string, RegExp> = {
  download: /download|tarball|fetch|rate.limit|codeload|empty.response|403|429|gzip/i,
  verify: /skill\.md|not.contain|not.found.*skill/i,
  extract: /extract|archive|tar|empty.director/i,
  install: /import|install.*fail|workspace/i,
}

function mapErrorToStep(error: string, steps: InstallStep[]): number {
  for (let i = 0; i < steps.length; i++) {
    const pattern = STEP_ERROR_PATTERNS[steps[i].id]
    if (pattern?.test(error)) return i
  }
  return 0 // default to first step
}

// ─── Hook ────────────────────────────────────────────────────

interface InstallParams {
  slug: string
  marketplaceId: MarketplaceId
  scope: 'global' | 'project'
  projectId?: string
  /** Namespace prefix for multi-capability packages (e.g. "superpowers"). */
  namespacePrefix?: string
}

export interface UseMarketInstallResult {
  installing: boolean
  result: MarketInstallResult | null
  error: string | null
  progress: InstallProgress | null
  install: (params: InstallParams) => Promise<MarketInstallResult>
  reset: () => void
}

/**
 * Marketplace install hook with **honest progress reporting**.
 *
 * During installation, the first step stays "active" with a pulsing
 * indicator — no fake step advancement. When the IPC resolves:
 *
 *  - **Success** → rapid cascade animation: each step ticks to done
 *    sequentially (100ms apart) for a satisfying "check check check" effect.
 *
 *  - **Error** → steps before the failure point show done, the failed
 *    step shows error, steps after remain pending. The error step is
 *    determined by keyword matching against the error message.
 *
 * This design NEVER shows a green check that later reverts — once done,
 * always done.
 */
export function useMarketInstall(): UseMarketInstallResult {
  const [installing, setInstalling] = useState(false)
  const [result, setResult] = useState<MarketInstallResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<InstallProgress | null>(null)

  const cascadeRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearCascade = useCallback(() => {
    if (cascadeRef.current !== null) {
      clearTimeout(cascadeRef.current)
      cascadeRef.current = null
    }
  }, [])

  /**
   * Animate success: rapidly cascade all steps to done (100ms each).
   * Returns a Promise that resolves when the animation completes.
   */
  const cascadeSuccess = useCallback(
    (steps: InstallStep[]) => {
      let i = 0
      const tick = (): void => {
        if (i >= steps.length) return
        steps[i] = { ...steps[i], status: 'done' }
        i++
        setProgress({ steps: steps.map((s) => ({ ...s })), currentStepIndex: i - 1 })
        if (i < steps.length) {
          cascadeRef.current = setTimeout(tick, CASCADE_INTERVAL)
        }
      }
      tick()
    },
    [],
  )

  /**
   * Immediately mark the correct step as error — no animation.
   * Steps before error → done, error step → error, rest → pending.
   */
  const setErrorState = useCallback(
    (steps: InstallStep[], errMsg: string) => {
      const errorIdx = mapErrorToStep(errMsg, steps)
      for (let i = 0; i < steps.length; i++) {
        if (i < errorIdx) steps[i] = { ...steps[i], status: 'done' }
        else if (i === errorIdx) steps[i] = { ...steps[i], status: 'error' }
        else steps[i] = { ...steps[i], status: 'pending' }
      }
      setProgress({
        steps: steps.map((s) => ({ ...s })),
        currentStepIndex: errorIdx,
        errorMessage: errMsg,
      })
    },
    [],
  )

  /* ── main install function ──────────────────────────────── */

  const install = useCallback(
    async (params: InstallParams): Promise<MarketInstallResult> => {
      clearCascade()
      setInstalling(true)
      setError(null)
      setResult(null)

      // Initialize steps — first step active, rest pending
      const steps: InstallStep[] = SKILL_STEP_DEFS.map((d, i) => ({
        ...d,
        status: i === 0 ? ('active' as const) : ('pending' as const),
      }))

      setProgress({
        steps: steps.map((s) => ({ ...s })),
        currentStepIndex: 0,
      })

      try {
        const res = await getAppAPI()['market:install']({
          slug: params.slug,
          marketplaceId: params.marketplaceId,
          scope: params.scope,
          projectId: params.projectId,
          namespacePrefix: params.namespacePrefix,
        })

        // Success → cascade animation
        setResult(res)
        cascadeSuccess(steps)
        setInstalling(false)
        return res
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Installation failed'

        // Error → instant, honest feedback
        setError(message)
        setErrorState(steps, message)
        setInstalling(false)
        throw err
      }
    },
    [clearCascade, cascadeSuccess, setErrorState],
  )

  const reset = useCallback(() => {
    clearCascade()
    setInstalling(false)
    setResult(null)
    setError(null)
    setProgress(null)
  }, [clearCascade])

  return { installing, result, error, progress, install, reset }
}
