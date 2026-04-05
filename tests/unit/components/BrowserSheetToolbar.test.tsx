// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { useBrowserOverlayStore } from '../../../src/renderer/stores/browserOverlayStore'
import { BrowserSheetToolbar } from '../../../src/renderer/components/BrowserSheet/BrowserSheetToolbar'

const blockSpy = vi.fn()
const switchPolicySpy = vi.fn()

vi.mock('../../../src/renderer/hooks/useBlockBrowserView', () => ({
  useBlockBrowserView: (id: string, active: boolean) => {
    blockSpy(id, active)
  },
}))

describe('BrowserSheetToolbar', () => {
  beforeEach(() => {
    blockSpy.mockClear()
    switchPolicySpy.mockReset()
    switchPolicySpy.mockResolvedValue(undefined)
    useBrowserOverlayStore.getState().reset()
    useBrowserOverlayStore.setState((s) => ({
      ...s,
      switchBrowserStatePolicy: switchPolicySpy,
    }))
    useBrowserOverlayStore.getState().openBrowserOverlay({ type: 'standalone' })
    useBrowserOverlayStore.setState((s) => ({
      browserOverlay: s.browserOverlay
        ? {
            ...s.browserOverlay,
            viewId: 'view-1',
            statePolicy: 'shared-global',
            profiles: [
              { id: 'profile-1', name: 'Profile 1' },
              { id: 'profile-2', name: 'Profile 2' },
            ],
            activeProfileId: 'profile-1',
          }
        : null,
    }))
  })

  it('activates browser view blocker while state mode dropdown is open', () => {
    render(
      <BrowserSheetToolbar
        source={{ type: 'standalone' }}
        statePolicy="shared-global"
        onClose={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'State mode' })
    fireEvent.click(trigger)

    expect(blockSpy).toHaveBeenCalledWith('browser-state-mode-dropdown', true)

    fireEvent.mouseDown(document.body)

    expect(blockSpy).toHaveBeenCalledWith('browser-state-mode-dropdown', false)
  })

  it('disables project policy in Home context and does not trigger switch', () => {
    render(
      <BrowserSheetToolbar
        source={{ type: 'standalone' }}
        statePolicy="shared-global"
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'State mode' }))

    const sharedProjectOption = screen.getByRole('button', { name: /Shared: Project/i })
    expect(sharedProjectOption).toBeDisabled()
    expect(sharedProjectOption).toHaveAttribute('title', 'Requires project context')

    fireEvent.click(sharedProjectOption)
    expect(switchPolicySpy).not.toHaveBeenCalled()
  })
})
