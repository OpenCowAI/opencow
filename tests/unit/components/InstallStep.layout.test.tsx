// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import i18next from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { InstallStep } from '../../../src/renderer/components/Onboarding/InstallStep'

describe('InstallStep layout behavior', () => {
  it('keeps footer actions outside the scrollable content area in idle phase', () => {
    render(
      <InstallStep
        stepConfig={{ stepNumber: 3, totalSteps: 6 }}
        onBack={vi.fn()}
        onSkip={vi.fn()}
        onInstalled={vi.fn()}
      />
    )

    const scrollContent = screen.getByTestId('onboarding-scroll-content')
    const installNowButton = screen.getByRole('button', {
      name: i18next.t('install.installNow', { ns: 'onboarding' }),
    })

    expect(scrollContent).toHaveClass('overflow-y-auto')
    expect(scrollContent).not.toContainElement(installNowButton)
  })
})
