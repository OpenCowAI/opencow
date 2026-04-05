// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { BrowserService } from '../../../electron/browser/browserService'

describe('BrowserService profile rebind navigation', () => {
  it('carries over current URL when session view is rebound to another profile', async () => {
    const service = new BrowserService({
      dispatch: vi.fn() as never,
      store: {} as never,
    })

    const loadURL = vi.fn().mockResolvedValue(undefined)
    const existingManaged = {
      id: 'view-old',
      profileId: 'profile-old',
      profileName: 'Old Profile',
      view: {
        webContents: {
          isDestroyed: () => false,
          getURL: () => 'https://x.com/home',
          loadURL: vi.fn(),
        },
      },
      session: {},
      executor: {},
      decorator: {},
      interceptor: {},
    }
    const newManaged = {
      id: 'view-new',
      profileId: 'profile-new',
      profileName: 'New Profile',
      view: {
        webContents: {
          isDestroyed: () => false,
          getURL: () => 'about:blank',
          loadURL,
        },
      },
      session: {},
      executor: {},
      decorator: {},
      interceptor: {},
    }

    ;(service as unknown as { sessionViews: Map<string, string> }).sessionViews.set('session-1', 'view-old')
    ;(service as unknown as { managedViews: Map<string, unknown> }).managedViews.set('view-old', existingManaged)

    const openViewSpy = vi.fn().mockResolvedValue('view-new')
    const resolveProfileIdSpy = vi.fn().mockResolvedValue('profile-new')
    const closeViewSpy = vi.fn().mockResolvedValue(undefined)
    const setDisplayedViewSpy = vi.fn()
    const getWindow = vi.fn().mockResolvedValue({} as never)

    ;(
      service as unknown as {
        openView: (profileId: string, win: unknown) => Promise<string>
        resolveProfileId: (preferredProfileId?: string) => Promise<string>
        closeView: (viewId: string) => Promise<void>
        setDisplayedView: (viewId: string, binding?: unknown) => void
      }
    ).openView = openViewSpy
    ;(service as unknown as { resolveProfileId: (preferredProfileId?: string) => Promise<string> }).resolveProfileId =
      resolveProfileIdSpy
    ;(service as unknown as { closeView: (viewId: string) => Promise<void> }).closeView = closeViewSpy
    ;(service as unknown as { setDisplayedView: (viewId: string, binding?: unknown) => void }).setDisplayedView =
      setDisplayedViewSpy

    openViewSpy.mockImplementation(async () => {
      ;(service as unknown as { managedViews: Map<string, unknown> }).managedViews.set('view-new', newManaged)
      return 'view-new'
    })

    const viewId = await service.getOrCreateSessionView('session-1', getWindow, 'profile-new')

    expect(viewId).toBe('view-new')
    expect(loadURL).toHaveBeenCalledWith('https://x.com/home')
    expect(closeViewSpy).toHaveBeenCalledWith('view-old')
  })

  it('does not load URL when previous page is about:blank', async () => {
    const service = new BrowserService({
      dispatch: vi.fn() as never,
      store: {} as never,
    })

    const loadURL = vi.fn().mockResolvedValue(undefined)
    const existingManaged = {
      id: 'view-old',
      profileId: 'profile-old',
      profileName: 'Old Profile',
      view: {
        webContents: {
          isDestroyed: () => false,
          getURL: () => 'about:blank',
          loadURL: vi.fn(),
        },
      },
      session: {},
      executor: {},
      decorator: {},
      interceptor: {},
    }
    const newManaged = {
      id: 'view-new',
      profileId: 'profile-new',
      profileName: 'New Profile',
      view: {
        webContents: {
          isDestroyed: () => false,
          getURL: () => 'about:blank',
          loadURL,
        },
      },
      session: {},
      executor: {},
      decorator: {},
      interceptor: {},
    }

    ;(service as unknown as { sessionViews: Map<string, string> }).sessionViews.set('session-1', 'view-old')
    ;(service as unknown as { managedViews: Map<string, unknown> }).managedViews.set('view-old', existingManaged)

    const openViewSpy = vi.fn().mockResolvedValue('view-new')
    const resolveProfileIdSpy = vi.fn().mockResolvedValue('profile-new')
    const closeViewSpy = vi.fn().mockResolvedValue(undefined)
    const setDisplayedViewSpy = vi.fn()
    const getWindow = vi.fn().mockResolvedValue({} as never)

    ;(
      service as unknown as {
        openView: (profileId: string, win: unknown) => Promise<string>
        resolveProfileId: (preferredProfileId?: string) => Promise<string>
        closeView: (viewId: string) => Promise<void>
        setDisplayedView: (viewId: string, binding?: unknown) => void
      }
    ).openView = openViewSpy
    ;(service as unknown as { resolveProfileId: (preferredProfileId?: string) => Promise<string> }).resolveProfileId =
      resolveProfileIdSpy
    ;(service as unknown as { closeView: (viewId: string) => Promise<void> }).closeView = closeViewSpy
    ;(service as unknown as { setDisplayedView: (viewId: string, binding?: unknown) => void }).setDisplayedView =
      setDisplayedViewSpy

    openViewSpy.mockImplementation(async () => {
      ;(service as unknown as { managedViews: Map<string, unknown> }).managedViews.set('view-new', newManaged)
      return 'view-new'
    })

    const viewId = await service.getOrCreateSessionView('session-1', getWindow, 'profile-new')

    expect(viewId).toBe('view-new')
    expect(loadURL).not.toHaveBeenCalled()
    expect(closeViewSpy).toHaveBeenCalledWith('view-old')
  })

  it('rolls back session rebind when navigation priming fails', async () => {
    const service = new BrowserService({
      dispatch: vi.fn() as never,
      store: {} as never,
    })

    const loadURL = vi.fn().mockRejectedValue(new Error('navigation-failed'))
    const existingManaged = {
      id: 'view-old',
      profileId: 'profile-old',
      profileName: 'Old Profile',
      view: {
        webContents: {
          isDestroyed: () => false,
          getURL: () => 'https://x.com/home',
          loadURL: vi.fn(),
        },
      },
      session: {},
      executor: {},
      decorator: {},
      interceptor: {},
    }
    const newManaged = {
      id: 'view-new',
      profileId: 'profile-new',
      profileName: 'New Profile',
      view: {
        webContents: {
          isDestroyed: () => false,
          getURL: () => 'about:blank',
          loadURL,
        },
      },
      session: {},
      executor: {},
      decorator: {},
      interceptor: {},
    }

    ;(service as unknown as { sessionViews: Map<string, string> }).sessionViews.set('session-1', 'view-old')
    ;(service as unknown as { managedViews: Map<string, unknown> }).managedViews.set('view-old', existingManaged)

    const openViewSpy = vi.fn().mockResolvedValue('view-new')
    const resolveProfileIdSpy = vi.fn().mockResolvedValue('profile-new')
    const closeViewSpy = vi.fn().mockResolvedValue(undefined)
    const setDisplayedViewSpy = vi.fn()
    const getWindow = vi.fn().mockResolvedValue({} as never)

    ;(
      service as unknown as {
        openView: (profileId: string, win: unknown) => Promise<string>
        resolveProfileId: (preferredProfileId?: string) => Promise<string>
        closeView: (viewId: string) => Promise<void>
        setDisplayedView: (viewId: string, binding?: unknown) => void
      }
    ).openView = openViewSpy
    ;(service as unknown as { resolveProfileId: (preferredProfileId?: string) => Promise<string> }).resolveProfileId =
      resolveProfileIdSpy
    ;(service as unknown as { closeView: (viewId: string) => Promise<void> }).closeView = closeViewSpy
    ;(service as unknown as { setDisplayedView: (viewId: string, binding?: unknown) => void }).setDisplayedView =
      setDisplayedViewSpy

    openViewSpy.mockImplementation(async () => {
      ;(service as unknown as { managedViews: Map<string, unknown> }).managedViews.set('view-new', newManaged)
      return 'view-new'
    })

    await expect(service.getOrCreateSessionView('session-1', getWindow, 'profile-new')).rejects.toThrow(
      'navigation-failed',
    )
    expect(setDisplayedViewSpy).not.toHaveBeenCalled()
    expect(closeViewSpy).toHaveBeenCalledTimes(1)
    expect(closeViewSpy).toHaveBeenCalledWith('view-new')
    expect(closeViewSpy).not.toHaveBeenCalledWith('view-old')
    expect((service as unknown as { sessionViews: Map<string, string> }).sessionViews.get('session-1')).toBe(
      'view-old',
    )
  })

  it('skips URL carry-over for non-http schemes during rebind', async () => {
    const service = new BrowserService({
      dispatch: vi.fn() as never,
      store: {} as never,
    })

    const loadURL = vi.fn().mockResolvedValue(undefined)
    const existingManaged = {
      id: 'view-old',
      profileId: 'profile-old',
      profileName: 'Old Profile',
      view: {
        webContents: {
          isDestroyed: () => false,
          getURL: () => 'data:text/html,<h1>x</h1>',
          loadURL: vi.fn(),
        },
      },
      session: {},
      executor: {},
      decorator: {},
      interceptor: {},
    }
    const newManaged = {
      id: 'view-new',
      profileId: 'profile-new',
      profileName: 'New Profile',
      view: {
        webContents: {
          isDestroyed: () => false,
          getURL: () => 'about:blank',
          loadURL,
        },
      },
      session: {},
      executor: {},
      decorator: {},
      interceptor: {},
    }

    ;(service as unknown as { sessionViews: Map<string, string> }).sessionViews.set('session-1', 'view-old')
    ;(service as unknown as { managedViews: Map<string, unknown> }).managedViews.set('view-old', existingManaged)

    const openViewSpy = vi.fn().mockResolvedValue('view-new')
    const resolveProfileIdSpy = vi.fn().mockResolvedValue('profile-new')
    const closeViewSpy = vi.fn().mockResolvedValue(undefined)
    const setDisplayedViewSpy = vi.fn()
    const getWindow = vi.fn().mockResolvedValue({} as never)

    ;(
      service as unknown as {
        openView: (profileId: string, win: unknown) => Promise<string>
        resolveProfileId: (preferredProfileId?: string) => Promise<string>
        closeView: (viewId: string) => Promise<void>
        setDisplayedView: (viewId: string, binding?: unknown) => void
      }
    ).openView = openViewSpy
    ;(service as unknown as { resolveProfileId: (preferredProfileId?: string) => Promise<string> }).resolveProfileId =
      resolveProfileIdSpy
    ;(service as unknown as { closeView: (viewId: string) => Promise<void> }).closeView = closeViewSpy
    ;(service as unknown as { setDisplayedView: (viewId: string, binding?: unknown) => void }).setDisplayedView =
      setDisplayedViewSpy

    openViewSpy.mockImplementation(async () => {
      ;(service as unknown as { managedViews: Map<string, unknown> }).managedViews.set('view-new', newManaged)
      return 'view-new'
    })

    const viewId = await service.getOrCreateSessionView('session-1', getWindow, 'profile-new')

    expect(viewId).toBe('view-new')
    expect(loadURL).not.toHaveBeenCalled()
    expect(closeViewSpy).toHaveBeenCalledWith('view-old')
  })
})
