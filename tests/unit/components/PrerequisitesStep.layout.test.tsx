// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import i18next from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { PrerequisitesStep } from '../../../src/renderer/components/Onboarding/PrerequisitesStep'
import { APP_WINDOW_KEY } from '../../../src/shared/appIdentity'

describe('PrerequisitesStep layout behavior', () => {
  it('keeps footer actions outside the scrollable content area', async () => {
    const appAPI = ((window as unknown as Record<string, unknown>)[APP_WINDOW_KEY] ??
      {}) as Record<string, unknown>
    appAPI['check-prerequisites'] = vi.fn(async () => ({
      canProceed: true,
      items: [
        { name: 'Claude Code', satisfied: true, required: false, version: '1.0.0' },
      ],
    }))
    ;(window as unknown as Record<string, unknown>)[APP_WINDOW_KEY] = appAPI

    render(
      <PrerequisitesStep
        stepConfig={{ stepNumber: 1, totalSteps: 4 }}
        onResult={vi.fn()}
        onBack={vi.fn()}
        onContinue={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: i18next.t('common.continue', { ns: 'onboarding' }),
        })
      ).toBeInTheDocument()
    })

    const scrollContent = screen.getByTestId('onboarding-scroll-content')
    const continueButton = screen.getByRole('button', {
      name: i18next.t('common.continue', { ns: 'onboarding' }),
    })

    expect(scrollContent).toHaveClass('overflow-y-auto')
    expect(scrollContent).not.toContainElement(continueButton)
  })
})
