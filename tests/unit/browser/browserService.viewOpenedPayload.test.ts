// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { BrowserService } from '../../../electron/browser/browserService'

function createService() {
  const dispatch = vi.fn()
  const service = new BrowserService({
    dispatch: dispatch as never,
    store: {} as never,
  })
  return { service, dispatch }
}

describe('BrowserService browser:view:opened payload', () => {
  it('emits source/binding metadata from view sourceBinding', () => {
    const { service, dispatch } = createService()
    ;(service as unknown as { managedViews: Map<string, unknown> }).managedViews.set('view-1', {
      id: 'view-1',
      profileId: 'profile-1',
      profileName: 'Profile 1',
      view: { webContents: { isDestroyed: () => false } },
      session: {},
      executor: {},
      decorator: {},
      interceptor: {},
      sourceBinding: {
        policy: 'shared-project',
        profileId: 'profile-1',
        reason: 'policy:shared-project:project:project-1',
        sourceType: 'issue-session',
        projectId: 'project-1',
        issueId: 'issue-1',
        sessionId: 'session-1',
      },
    })

    ;(
      service as unknown as {
        setDisplayedView: (viewId: string) => void
      }
    ).setDisplayedView('view-1')

    expect(dispatch).toHaveBeenCalledWith({
      type: 'browser:view:opened',
      payload: {
        viewId: 'view-1',
        profileId: 'profile-1',
        profileName: 'Profile 1',
        source: {
          type: 'issue-session',
          issueId: 'issue-1',
          sessionId: 'session-1',
        },
        statePolicy: 'shared-project',
        projectId: 'project-1',
        profileBindingReason: 'policy:shared-project:project:project-1',
      },
    })
  })

  it('falls back to map-derived standalone source when no binding is available', () => {
    const { service, dispatch } = createService()
    ;(service as unknown as { managedViews: Map<string, unknown> }).managedViews.set('view-2', {
      id: 'view-2',
      profileId: 'profile-2',
      profileName: 'Profile 2',
      view: { webContents: { isDestroyed: () => false } },
      session: {},
      executor: {},
      decorator: {},
      interceptor: {},
    })

    ;(
      service as unknown as {
        setDisplayedView: (viewId: string) => void
      }
    ).setDisplayedView('view-2')

    expect(dispatch).toHaveBeenCalledWith({
      type: 'browser:view:opened',
      payload: {
        viewId: 'view-2',
        profileId: 'profile-2',
        profileName: 'Profile 2',
        source: { type: 'standalone' },
        statePolicy: 'shared-global',
        projectId: null,
        profileBindingReason: 'legacy:map-derived',
      },
    })
  })
})

