// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import i18next from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { DisclosureStep } from '../../../src/renderer/components/Onboarding/DisclosureStep'

describe('DisclosureStep layout behavior', () => {
  it('keeps footer actions outside the scrollable content area', async () => {
    render(
      <DisclosureStep
        stepConfig={{ stepNumber: 2, totalSteps: 6 }}
        onSkip={vi.fn()}
        onContinue={vi.fn()}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: 'Toggle hook events list' }))

    const scrollContent = screen.getByTestId('onboarding-scroll-content')
    const continueButton = screen.getByRole('button', {
      name: i18next.t('common.continue', { ns: 'onboarding' }),
    })
    const title = screen.getByRole('heading', {
      name: i18next.t('disclosure.title', { ns: 'onboarding' }),
    })
    const subtitle = screen.getByText(i18next.t('disclosure.subtitle', { ns: 'onboarding' }))

    expect(scrollContent).toHaveClass('overflow-y-auto')
    expect(scrollContent).not.toContainElement(continueButton)
    expect(scrollContent).not.toContainElement(title)
    expect(scrollContent).not.toContainElement(subtitle)
  })
})
