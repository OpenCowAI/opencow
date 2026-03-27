// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useRef } from 'react'
import { useAppStore } from '@/stores/appStore'
import { cn } from '@/lib/utils'
import { getAppAPI } from '@/windowAPI'
import type { PrerequisiteCheckResult } from '@shared/types'
import { OnboardingLanguageSwitcher } from './OnboardingLanguageSwitcher'
import { WelcomeStep } from './WelcomeStep'
import { PrerequisitesStep } from './PrerequisitesStep'
import { DisclosureStep } from './DisclosureStep'
import { InstallStep } from './InstallStep'
import { ProviderSetupStep } from './ProviderSetupStep'
import { ImportStep } from './ImportStep'
import { DoneStep } from './DoneStep'
import { useBlockBrowserView } from '@/hooks/useBlockBrowserView'

type OnboardingStep = 'welcome' | 'prerequisites' | 'disclosure' | 'install' | 'provider-setup' | 'import' | 'done'

/** Duration of the exit fade-out (must match CSS `.onboarding-exit`). */
const EXIT_DURATION = 300

/**
 * OnboardingModal — Orchestrator for the multi-step onboarding flow.
 *
 * Responsibilities:
 *   - Step state machine & navigation
 *   - Exit animation coordination
 *   - Layout (full-screen backdrop, centered card, language switcher)
 *
 * Each step is a self-contained component with its own i18n.
 * Cross-step state (prerequisite result → step count) is managed here.
 */
export function OnboardingModal(): React.JSX.Element | null {
  const onboarding = useAppStore((s) => s.onboarding)
  const [step, setStep] = useState<OnboardingStep>('welcome')
  const [exiting, setExiting] = useState(false)
  const exitingRef = useRef(false)

  // Cross-step state: whether Claude Code CLI was detected (affects step count & routing)
  const [claudeCodeAvailable, setClaudeCodeAvailable] = useState(false)

  // Cross-step state: whether the provider was configured during onboarding
  const [providerConfigured, setProviderConfigured] = useState(false)

  useBlockBrowserView('onboarding-modal', !onboarding.completed)

  /**
   * Dynamic step count:
   *  - With Claude Code CLI:    prerequisites(1) → disclosure(2) → install(3) → provider-setup(4) → import(5) → done(6)
   *  - Without Claude Code CLI: prerequisites(1) → provider-setup(2) → import(3) → done(4)
   */
  const totalSteps = claudeCodeAvailable ? 6 : 4

  /** Map step names to display numbers (welcome has no indicator). */
  const stepNumber = useCallback(
    (s: OnboardingStep): number => {
      if (claudeCodeAvailable) {
        const map: Record<OnboardingStep, number> = {
          welcome: 0, prerequisites: 1, disclosure: 2, install: 3, 'provider-setup': 4, import: 5, done: 6,
        }
        return map[s]
      }
      const map: Record<OnboardingStep, number> = {
        welcome: 0, prerequisites: 1, disclosure: 2, install: 2, 'provider-setup': 2, import: 3, done: 4,
      }
      return map[s]
    },
    [claudeCodeAvailable]
  )

  /** Called by PrerequisitesStep when checks complete */
  const handlePrereqResult = useCallback((result: PrerequisiteCheckResult) => {
    const available = result.items.find((i) => i.name === 'Claude Code')?.satisfied ?? false
    setClaudeCodeAvailable(available)
  }, [])

  /** Navigate from prerequisites to next step */
  const handlePrereqContinue = useCallback(() => {
    if (claudeCodeAvailable) {
      setStep('disclosure')
    } else {
      setStep('provider-setup')
    }
  }, [claudeCodeAvailable])

  /** Play exit animation, then call the actual completion IPC. */
  const exitThenComplete = useCallback(async () => {
    if (exitingRef.current) return
    exitingRef.current = true
    setExiting(true)
    await delay(EXIT_DURATION)
    const state = await getAppAPI()['complete-onboarding']()
    useAppStore.getState().setOnboarding(state)
  }, [])

  if (onboarding.completed && !exiting) return null

  return (
    <div
      className={cn(
        'fixed inset-0 z-[100] flex items-center justify-center bg-[hsl(var(--background))] no-drag',
        exiting && 'onboarding-exit pointer-events-none',
      )}
    >
      {/* Language switcher — top-right corner, pushed down to clear macOS traffic-light drag region */}
      <div className="no-drag absolute top-10 right-6 z-10" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <OnboardingLanguageSwitcher />
      </div>

      <div className="w-full max-w-lg px-8 py-10">
        {step === 'welcome' && (
          <WelcomeStep onStart={() => setStep('prerequisites')} />
        )}

        {step === 'prerequisites' && (
          <PrerequisitesStep
            stepConfig={{ stepNumber: stepNumber('prerequisites'), totalSteps }}
            onResult={handlePrereqResult}
            onBack={() => setStep('welcome')}
            onContinue={handlePrereqContinue}
          />
        )}

        {step === 'disclosure' && (
          <DisclosureStep
            stepConfig={{ stepNumber: stepNumber('disclosure'), totalSteps }}
            onSkip={() => setStep('provider-setup')}
            onContinue={() => setStep('install')}
          />
        )}

        {step === 'install' && (
          <InstallStep
            stepConfig={{ stepNumber: stepNumber('install'), totalSteps }}
            onBack={() => setStep('disclosure')}
            onSkip={() => setStep('provider-setup')}
            onInstalled={() => setStep('provider-setup')}
          />
        )}

        {step === 'provider-setup' && (
          <ProviderSetupStep
            stepConfig={{ stepNumber: stepNumber('provider-setup'), totalSteps }}
            onBack={() => setStep(claudeCodeAvailable ? 'install' : 'prerequisites')}
            onContinue={() => setStep('import')}
            onProviderConfigured={setProviderConfigured}
          />
        )}

        {step === 'import' && (
          <ImportStep
            stepConfig={{ stepNumber: stepNumber('import'), totalSteps }}
            onComplete={() => setStep('done')}
          />
        )}

        {step === 'done' && (
          <DoneStep
            stepConfig={{ stepNumber: stepNumber('done'), totalSteps }}
            claudeCodeAvailable={claudeCodeAvailable}
            providerConfigured={providerConfigured}
            onComplete={() => void exitThenComplete()}
          />
        )}
      </div>
    </div>
  )
}

/** Simple delay helper */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
