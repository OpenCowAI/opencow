// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataBusEvent } from '../../../src/shared/types'
import { useBrowserOverlayStore } from '../../../src/renderer/stores/browserOverlayStore'

const apiMock = vi.hoisted(() => {
  const listeners: Array<(event: DataBusEvent) => void> = []
  const onEvent = vi.fn((cb: (event: DataBusEvent) => void) => {
    listeners.push(cb)
    return () => {
      const idx = listeners.indexOf(cb)
      if (idx >= 0) listeners.splice(idx, 1)
    }
  })
  return {
    listeners,
    api: {
      'on:opencow:event': onEvent,
      'log:write': vi.fn(async () => undefined),
    },
  }
})

vi.mock('@/windowAPI', () => ({
  getAppAPI: () => apiMock.api,
}))

vi.mock('@/lib/bootstrap/bootstrapCoordinator', () => ({
  ensureBootstrapDataLoaded: vi.fn(async () => undefined),
}))

import { useAppBootstrap } from '../../../src/renderer/hooks/useAppBootstrap'

function emit(event: DataBusEvent): void {
  for (const listener of [...apiMock.listeners]) {
    listener(event)
  }
}

describe('useAppBootstrap browser:view:opened guard', () => {
  beforeEach(() => {
    apiMock.listeners.splice(0, apiMock.listeners.length)
    useBrowserOverlayStore.getState().reset()
  })

  it('does not overwrite visible BrowserSheet binding when incoming source differs', () => {
    const store = useBrowserOverlayStore.getState()
    store.openBrowserOverlay({ type: 'issue-session', issueId: 'issue-a', sessionId: 'session-a' })
    store.setBrowserOverlayViewId('view-a')
    store.setBrowserOverlayActiveProfileId('profile-a')
    store.setBrowserOverlayStatePolicy('shared-global')
    store.setBrowserOverlayProfileBindingReason('policy:shared-global:global')

    const { unmount } = renderHook(() => useAppBootstrap())

    act(() => {
      emit({
        type: 'browser:view:opened',
        payload: {
          viewId: 'view-b',
          profileId: 'profile-b',
          profileName: 'Profile B',
          source: { type: 'issue-session', issueId: 'issue-a', sessionId: 'session-b' },
          statePolicy: 'shared-global',
          projectId: null,
          profileBindingReason: 'policy:shared-global:global',
        },
      })
    })

    const overlay = useBrowserOverlayStore.getState().browserOverlay
    expect(overlay?.viewId).toBe('view-a')
    expect(overlay?.activeProfileId).toBe('profile-a')
    expect(overlay?.profileBindingReason).toBe('policy:shared-global:global')

    unmount()
  })

  it('updates visible BrowserSheet binding when incoming source matches', () => {
    const store = useBrowserOverlayStore.getState()
    store.openBrowserOverlay({ type: 'issue-session', issueId: 'issue-a', sessionId: 'session-a' })
    store.setBrowserOverlayViewId('view-old')
    store.setBrowserOverlayActiveProfileId('profile-old')
    store.setBrowserOverlayStatePolicy('shared-global')
    store.setBrowserOverlayProfileBindingReason('policy:shared-global:global')

    const { unmount } = renderHook(() => useAppBootstrap())

    act(() => {
      emit({
        type: 'browser:view:opened',
        payload: {
          viewId: 'view-new',
          profileId: 'profile-new',
          profileName: 'Profile New',
          source: { type: 'issue-session', issueId: 'issue-a', sessionId: 'session-a' },
          statePolicy: 'isolated-session',
          projectId: 'project-1',
          profileBindingReason: 'policy:isolated-session:session:session-a',
        },
      })
    })

    const overlay = useBrowserOverlayStore.getState().browserOverlay
    expect(overlay?.viewId).toBe('view-new')
    expect(overlay?.activeProfileId).toBe('profile-new')
    expect(overlay?.statePolicy).toBe('isolated-session')
    expect(overlay?.profileBindingReason).toBe('policy:isolated-session:session:session-a')

    unmount()
  })
})
