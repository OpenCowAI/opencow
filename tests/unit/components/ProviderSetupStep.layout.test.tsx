// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import i18next from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ProviderSetupStep } from '../../../src/renderer/components/Onboarding/ProviderSetupStep'

vi.mock('../../../src/renderer/hooks/useProviderLogin', () => ({
  useProviderLogin: () => ({
    loading: false,
    error: null,
    login: vi.fn(async () => ({ success: false })),
    cancelLogin: vi.fn(async () => {}),
    clearError: vi.fn(),
  }),
}))

vi.mock('../../../src/renderer/stores/settingsStore', () => ({
  useSettingsStore: (selector: (s: {
    providerStatusByEngine: Record<string, { state: string; mode?: string } | undefined>
    loadProviderStatus: () => Promise<void>
  }) => unknown) =>
    selector({
      providerStatusByEngine: {},
      loadProviderStatus: async () => {},
    }),
}))

describe('ProviderSetupStep layout behavior', () => {
  it('keeps footer actions outside the scrollable content area', () => {
    render(
      <ProviderSetupStep
        stepConfig={{ stepNumber: 4, totalSteps: 6 }}
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onProviderConfigured={vi.fn()}
      />
    )

    const scrollContent = screen.getByTestId('onboarding-scroll-content')
    const continueButton = screen.getByRole('button', {
      name: i18next.t('common.continue', { ns: 'onboarding' }),
    })

    expect(scrollContent).toHaveClass('overflow-y-auto')
    expect(scrollContent).not.toContainElement(continueButton)
  })
})
