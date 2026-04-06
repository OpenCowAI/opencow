// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import i18next from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ImportStep } from '../../../src/renderer/components/Onboarding/ImportStep'
import { APP_WINDOW_KEY } from '../../../src/shared/appIdentity'

describe('ImportStep layout behavior', () => {
  it('keeps footer actions outside the scrollable content area', async () => {
    const appAPI = ((window as unknown as Record<string, unknown>)[APP_WINDOW_KEY] ??
      {}) as Record<string, unknown>
    appAPI['discover-importable-projects'] = vi.fn(async () => [])
    appAPI['import-discovered-projects'] = vi.fn(async () => {})
    ;(window as unknown as Record<string, unknown>)[APP_WINDOW_KEY] = appAPI

    render(
      <ImportStep
        stepConfig={{ stepNumber: 5, totalSteps: 6 }}
        onComplete={vi.fn()}
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
