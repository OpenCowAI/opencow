// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from 'vitest'
import {
  defaultBrowserPolicyForSource,
  normalizeBrowserPolicyForOverlayRequest,
  useBrowserOverlayStore,
} from '../../../src/renderer/stores/browserOverlayStore'

describe('browserOverlayStore policy defaults', () => {
  beforeEach(() => {
    useBrowserOverlayStore.getState().reset()
  })

  it('uses shared-global for standalone source', () => {
    const policy = defaultBrowserPolicyForSource({ type: 'standalone' })
    expect(policy).toBe('shared-global')
  })

  it('uses shared-global for issue/chat sources by default', () => {
    expect(defaultBrowserPolicyForSource({ type: 'issue-standalone', issueId: 'i-1' })).toBe('shared-global')
    expect(defaultBrowserPolicyForSource({ type: 'chat-session', sessionId: 's-1' })).toBe('shared-global')
    expect(
      defaultBrowserPolicyForSource({ type: 'issue-session', issueId: 'i-1', sessionId: 's-1' }),
    ).toBe('shared-global')
  })

  it('normalizes invalid policy requests by source context before dispatch', () => {
    expect(
      normalizeBrowserPolicyForOverlayRequest(
        { type: 'chat-session', sessionId: 's-1' },
        'shared-project',
        null,
      ),
    ).toBe('shared-global')

    expect(
      normalizeBrowserPolicyForOverlayRequest(
        { type: 'chat-session', sessionId: 's-1' },
        'isolated-issue',
        'project-1',
      ),
    ).toBe('isolated-session')

    expect(
      normalizeBrowserPolicyForOverlayRequest(
        { type: 'standalone' },
        'isolated-session',
        null,
      ),
    ).toBe('shared-global')

    expect(
      normalizeBrowserPolicyForOverlayRequest(
        { type: 'standalone' },
        'isolated-issue',
        null,
      ),
    ).toBe('shared-global')
  })

  it('openBrowserOverlay applies source-aware default policy', () => {
    const store = useBrowserOverlayStore.getState()
    store.openBrowserOverlay({ type: 'standalone' })
    expect(useBrowserOverlayStore.getState().browserOverlay?.statePolicy).toBe('shared-global')

    store.openBrowserOverlay({ type: 'chat-session', sessionId: 's-2' })
    expect(useBrowserOverlayStore.getState().browserOverlay?.statePolicy).toBe('shared-global')
  })

  it('restores overlay runtime state when switchBrowserStatePolicy fails', async () => {
    const appAPI = window.opencow as unknown as Record<string, unknown>
    const previousDisplaySource = appAPI['browser:display-source']
    appAPI['browser:display-source'] = async () => {
      throw new Error('mock failure')
    }
    try {
      const store = useBrowserOverlayStore.getState()
      store.openBrowserOverlay(
        { type: 'chat-session', sessionId: 's-1' },
        { policy: 'shared-project', projectId: 'project-1', preferredProfileId: 'profile-1' },
      )
      useBrowserOverlayStore.setState((s) => ({
        browserOverlay: s.browserOverlay
          ? {
              ...s.browserOverlay,
              viewId: 'view-1',
              pageInfo: { url: 'https://x.com/home', title: 'Home / X', isLoading: false },
              urlBarValue: 'https://x.com/home',
              agentSessionId: 'agent-session-1',
              agentState: 'idle',
              profileBindingReason: 'policy:shared-project:project:project-1',
            }
          : null,
      }))

      await store.switchBrowserStatePolicy('isolated-session')
      const overlay = useBrowserOverlayStore.getState().browserOverlay
      expect(overlay).not.toBeNull()
      expect(overlay!.statePolicy).toBe('shared-project')
      expect(overlay!.activeProfileId).toBe('profile-1')
      expect(overlay!.viewId).toBe('view-1')
      expect(overlay!.agentSessionId).toBe('agent-session-1')
      expect(overlay!.pageInfo?.url).toBe('https://x.com/home')
      expect(overlay!.isLoading).toBe(false)
    } finally {
      appAPI['browser:display-source'] = previousDisplaySource
    }
  })

  it('restores overlay runtime state when switchBrowserPreferredProfile fails', async () => {
    const appAPI = window.opencow as unknown as Record<string, unknown>
    const previousDisplaySource = appAPI['browser:display-source']
    appAPI['browser:display-source'] = async () => {
      throw new Error('mock failure')
    }
    try {
      const store = useBrowserOverlayStore.getState()
      store.openBrowserOverlay(
        { type: 'chat-session', sessionId: 's-1' },
        { policy: 'shared-project', projectId: 'project-1', preferredProfileId: 'profile-1' },
      )
      useBrowserOverlayStore.setState((s) => ({
        browserOverlay: s.browserOverlay
          ? {
              ...s.browserOverlay,
              viewId: 'view-1',
              pageInfo: { url: 'https://x.com/home', title: 'Home / X', isLoading: false },
              urlBarValue: 'https://x.com/home',
              agentSessionId: 'agent-session-1',
              agentState: 'idle',
              profileBindingReason: 'policy:shared-project:project:project-1',
            }
          : null,
      }))

      await store.switchBrowserPreferredProfile('profile-2')
      const overlay = useBrowserOverlayStore.getState().browserOverlay
      expect(overlay).not.toBeNull()
      expect(overlay!.statePolicy).toBe('shared-project')
      expect(overlay!.activeProfileId).toBe('profile-1')
      expect(overlay!.viewId).toBe('view-1')
      expect(overlay!.agentSessionId).toBe('agent-session-1')
      expect(overlay!.pageInfo?.url).toBe('https://x.com/home')
      expect(overlay!.isLoading).toBe(false)
    } finally {
      appAPI['browser:display-source'] = previousDisplaySource
    }
  })

  it('keeps active view and agent session during policy switch optimistic state', async () => {
    const appAPI = window.opencow as unknown as Record<string, unknown>
    const previousDisplaySource = appAPI['browser:display-source']
    appAPI['browser:display-source'] = () =>
      new Promise<never>(() => {
        // keep pending so we can assert optimistic state before resolution
      })

    try {
      const store = useBrowserOverlayStore.getState()
      store.openBrowserOverlay(
        { type: 'chat-session', sessionId: 's-1' },
        { policy: 'shared-global', projectId: null, preferredProfileId: 'profile-1' },
      )
      useBrowserOverlayStore.setState((s) => ({
        browserOverlay: s.browserOverlay
          ? {
              ...s.browserOverlay,
              viewId: 'view-1',
              pageInfo: { url: 'https://x.com/home', title: 'Home / X', isLoading: false },
              urlBarValue: 'https://x.com/home',
              agentSessionId: 'agent-session-1',
              agentState: 'idle',
            }
          : null,
      }))

      void store.switchBrowserStatePolicy('shared-project')
      const overlay = useBrowserOverlayStore.getState().browserOverlay
      expect(overlay).not.toBeNull()
      // No project scope: shared-project is normalized to shared-global (no-op)
      expect(overlay!.statePolicy).toBe('shared-global')
      expect(overlay!.viewId).toBe('view-1')
      expect(overlay!.agentSessionId).toBe('agent-session-1')
      expect(overlay!.pageInfo?.url).toBe('https://x.com/home')
      expect(overlay!.isLoading).toBe(false)
    } finally {
      appAPI['browser:display-source'] = previousDisplaySource
    }
  })

  it('keeps active view and agent session during profile switch optimistic state', async () => {
    const appAPI = window.opencow as unknown as Record<string, unknown>
    const previousDisplaySource = appAPI['browser:display-source']
    appAPI['browser:display-source'] = () =>
      new Promise<never>(() => {
        // keep pending so we can assert optimistic state before resolution
      })

    try {
      const store = useBrowserOverlayStore.getState()
      store.openBrowserOverlay(
        { type: 'chat-session', sessionId: 's-1' },
        { policy: 'shared-project', projectId: 'project-1', preferredProfileId: 'profile-1' },
      )
      useBrowserOverlayStore.setState((s) => ({
        browserOverlay: s.browserOverlay
          ? {
              ...s.browserOverlay,
              viewId: 'view-1',
              pageInfo: { url: 'https://x.com/home', title: 'Home / X', isLoading: false },
              urlBarValue: 'https://x.com/home',
              agentSessionId: 'agent-session-1',
              agentState: 'idle',
            }
          : null,
      }))

      void store.switchBrowserPreferredProfile('profile-2')
      const overlay = useBrowserOverlayStore.getState().browserOverlay
      expect(overlay).not.toBeNull()
      expect(overlay!.statePolicy).toBe('custom-profile')
      expect(overlay!.activeProfileId).toBe('profile-2')
      expect(overlay!.viewId).toBe('view-1')
      expect(overlay!.agentSessionId).toBe('agent-session-1')
      expect(overlay!.pageInfo?.url).toBe('https://x.com/home')
      expect(overlay!.isLoading).toBe(true)
    } finally {
      appAPI['browser:display-source'] = previousDisplaySource
    }
  })

  it('ignores stale policy-switch response when a newer switch request is in flight', async () => {
    const appAPI = window.opencow as unknown as Record<string, unknown>
    const previousDisplaySource = appAPI['browser:display-source']
    let resolveFirst: ((value: unknown) => void) | null = null
    let resolveSecond: ((value: unknown) => void) | null = null
    let call = 0
    appAPI['browser:display-source'] = () =>
      new Promise((resolve) => {
        call += 1
        if (call === 1) {
          resolveFirst = resolve
        } else {
          resolveSecond = resolve
        }
      })

    try {
      const store = useBrowserOverlayStore.getState()
      store.openBrowserOverlay(
        { type: 'chat-session', sessionId: 's-1' },
        { policy: 'shared-project', projectId: 'project-1', preferredProfileId: 'profile-1' },
      )

      const firstSwitch = store.switchBrowserStatePolicy('isolated-session')
      const secondSwitch = store.switchBrowserStatePolicy('shared-global')

      resolveSecond?.({
        viewId: 'view-second',
        profileId: 'profile-second',
        statePolicy: 'shared-global',
        profileBindingReason: 'policy:shared-global:global',
      })
      await secondSwitch

      resolveFirst?.({
        viewId: 'view-first',
        profileId: 'profile-first',
        statePolicy: 'isolated-session',
        profileBindingReason: 'policy:isolated-session:session:s-1',
      })
      await firstSwitch

      const overlay = useBrowserOverlayStore.getState().browserOverlay
      expect(overlay).not.toBeNull()
      expect(overlay!.statePolicy).toBe('shared-global')
      expect(overlay!.viewId).toBe('view-second')
      expect(overlay!.activeProfileId).toBe('profile-second')
    } finally {
      appAPI['browser:display-source'] = previousDisplaySource
    }
  })

  it('ignores in-flight switch response after overlay lifecycle changes (close and reopen)', async () => {
    const appAPI = window.opencow as unknown as Record<string, unknown>
    const previousDisplaySource = appAPI['browser:display-source']
    let resolveSwitch: ((value: unknown) => void) | null = null
    appAPI['browser:display-source'] = () =>
      new Promise((resolve) => {
        resolveSwitch = resolve
      })

    try {
      const store = useBrowserOverlayStore.getState()
      store.openBrowserOverlay(
        { type: 'chat-session', sessionId: 's-1' },
        { policy: 'shared-project', projectId: 'project-1', preferredProfileId: 'profile-1' },
      )

      const inFlight = store.switchBrowserStatePolicy('isolated-session')

      // Simulate lifecycle transition: user closes then reopens overlay with same source.
      store.closeBrowserOverlay()
      useBrowserOverlayStore.getState().finishBrowserSheetExit()
      store.openBrowserOverlay(
        { type: 'chat-session', sessionId: 's-1' },
        { policy: 'shared-project', projectId: 'project-1', preferredProfileId: 'profile-reopen' },
      )

      resolveSwitch?.({
        viewId: 'view-stale',
        profileId: 'profile-stale',
        statePolicy: 'isolated-session',
        profileBindingReason: 'policy:isolated-session:session:s-1',
      })
      await inFlight

      const overlay = useBrowserOverlayStore.getState().browserOverlay
      expect(overlay).not.toBeNull()
      expect(overlay!.activeProfileId).toBe('profile-reopen')
      expect(overlay!.viewId).toBeNull()
      expect(overlay!.statePolicy).toBe('shared-project')
    } finally {
      appAPI['browser:display-source'] = previousDisplaySource
    }
  })
})
