// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserSheet } from '../../../src/renderer/components/BrowserSheet/BrowserSheet'
import { useBrowserOverlayStore } from '../../../src/renderer/stores/browserOverlayStore'

vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div data-testid="panel-group">{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div data-testid="panel">{children}</div>,
  Separator: (props: React.HTMLAttributes<HTMLDivElement>) => <div data-testid="panel-separator" {...props} />,
}))

vi.mock('../../../src/renderer/components/BrowserSheet/BrowserSheetToolbar', () => ({
  BrowserSheetToolbar: () => <div data-testid="browser-toolbar" />,
}))

vi.mock('../../../src/renderer/components/BrowserSheet/BrowserSheetChat', () => ({
  BrowserSheetChat: () => <div data-testid="browser-chat" />,
}))

vi.mock('../../../src/renderer/components/BrowserSheet/BrowserViewportEdge', () => ({
  BrowserViewportEdge: () => <div data-testid="browser-edge" />,
}))

vi.mock('../../../src/renderer/components/BrowserSheet/ChatPanelErrorBoundary', () => ({
  ChatPanelErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../../../src/renderer/components/BrowserSheet/NativeViewport', () => ({
  NativeViewport: () => <div data-testid="native-viewport" />,
}))

vi.mock('../../../src/renderer/hooks/useBrowserSheetLifecycle', () => ({
  useBrowserSheetLifecycle: vi.fn(),
}))

vi.mock('../../../src/renderer/hooks/useBrowserViewOverlayGuard', () => ({
  useBrowserViewOverlayGuard: vi.fn(),
}))

describe('BrowserSheet', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useBrowserOverlayStore.getState().reset()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    act(() => {
      useBrowserOverlayStore.getState().reset()
    })
  })

  it('renders null when no browser overlay exists', () => {
    const { container } = render(<BrowserSheet />)
    expect(container.firstChild).toBeNull()
  })

  it('mounts NativeViewport via fallback timer when animationend is missed', () => {
    const store = useBrowserOverlayStore.getState()
    store.openBrowserOverlay({ type: 'standalone' })
    useBrowserOverlayStore.setState((s) => ({
      browserOverlay: s.browserOverlay
        ? {
            ...s.browserOverlay,
            viewId: 'view-1',
          }
        : null,
    }))

    render(<BrowserSheet />)

    // Initial state relies on animation completion, so viewport is not mounted yet.
    expect(screen.queryByTestId('native-viewport')).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(359)
    })
    expect(screen.queryByTestId('native-viewport')).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByTestId('native-viewport')).toBeInTheDocument()
  })
})
