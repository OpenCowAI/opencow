// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import i18next from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { DoneStep } from '../../../src/renderer/components/Onboarding/DoneStep'

describe('DoneStep layout behavior', () => {
  it('keeps header and footer outside the scrollable content area', () => {
    render(
      <DoneStep
        stepConfig={{ stepNumber: 6, totalSteps: 6 }}
        claudeCodeAvailable={true}
        providerConfigured={true}
        onComplete={vi.fn()}
      />
    )

    const scrollContent = screen.getByTestId('onboarding-scroll-content')
    const openAppButton = screen.getByRole('button', {
      name: i18next.t('done.openApp', { ns: 'onboarding' }),
    })
    const title = screen.getByRole('heading', {
      name: i18next.t('done.title', { ns: 'onboarding' }),
    })

    expect(scrollContent).toHaveClass('overflow-y-auto')
    expect(scrollContent).not.toContainElement(openAppButton)
    expect(scrollContent).toContainElement(title)
  })
})
