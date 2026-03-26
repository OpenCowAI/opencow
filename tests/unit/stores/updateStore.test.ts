// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { UpdateCheckResult } from '../../../src/shared/types'

// Shared mock that individual tests can override
const checkForUpdatesMock = vi.fn().mockResolvedValue(null)

// Mock getAppAPI before importing the store
vi.mock('@/windowAPI', () => ({
  getAppAPI: () => new Proxy({}, {
    get: (_target, prop) => {
      if (prop === 'check-for-updates') return checkForUpdatesMock
      return vi.fn().mockResolvedValue(null)
    },
  }),
}))

// Mock localStorage for dismiss persistence tests
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: () => { store = {} },
  }
})()
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

// Import AFTER mocks are set up
const { useUpdateStore } = await import('../../../src/renderer/stores/updateStore')

describe('updateStore', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
    useUpdateStore.setState({
      updateAvailable: false,
      latestVersion: null,
      releaseUrl: null,
      releaseNotes: null,
      downloadUrl: null,
      publishedAt: null,
      dismissedVersion: null,
      lastCheckedAt: null,
      checking: false,
    })
  })

  describe('onCheckResult', () => {
    it('sets update state when a new version is available', () => {
      const result: UpdateCheckResult = {
        status: 'available',
        currentVersion: '0.3.0',
        latestVersion: '0.4.0',
        releaseUrl: 'https://github.com/OpenCowAI/opencow/releases/tag/v0.4.0',
        releaseNotes: '## What\'s new\n- Feature X',
        publishedAt: '2026-03-26T00:00:00Z',
        downloadUrl: 'https://github.com/OpenCowAI/opencow/releases/download/v0.4.0/OpenCow-0.4.0-universal.dmg',
        checkedAt: '2026-03-26T10:00:00Z',
      }

      useUpdateStore.getState().onCheckResult(result)

      const state = useUpdateStore.getState()
      expect(state.updateAvailable).toBe(true)
      expect(state.latestVersion).toBe('0.4.0')
      expect(state.releaseUrl).toBe(result.releaseUrl)
      expect(state.releaseNotes).toBe(result.releaseNotes)
      expect(state.downloadUrl).toBe(result.downloadUrl)
      expect(state.publishedAt).toBe(result.publishedAt)
      expect(state.lastCheckedAt).toBe(result.checkedAt)
      expect(state.checking).toBe(false)
    })

    it('clears update state when already up-to-date', () => {
      // First, set an available update
      useUpdateStore.setState({
        updateAvailable: true,
        latestVersion: '0.4.0',
        releaseUrl: 'https://example.com',
      })

      const result: UpdateCheckResult = {
        status: 'up-to-date',
        currentVersion: '0.4.0',
        checkedAt: '2026-03-26T11:00:00Z',
      }

      useUpdateStore.getState().onCheckResult(result)

      const state = useUpdateStore.getState()
      expect(state.updateAvailable).toBe(false)
      expect(state.lastCheckedAt).toBe(result.checkedAt)
      expect(state.checking).toBe(false)
    })

    it('clears checking flag on result', () => {
      useUpdateStore.setState({ checking: true })

      useUpdateStore.getState().onCheckResult({
        status: 'up-to-date',
        currentVersion: '0.3.0',
        checkedAt: '2026-03-26T10:00:00Z',
      })

      expect(useUpdateStore.getState().checking).toBe(false)
    })
  })

  describe('dismissUpdate', () => {
    it('sets dismissedVersion to the current latest version', () => {
      useUpdateStore.setState({
        updateAvailable: true,
        latestVersion: '0.5.0',
      })

      useUpdateStore.getState().dismissUpdate()

      expect(useUpdateStore.getState().dismissedVersion).toBe('0.5.0')
    })

    it('persists dismissed version to localStorage', () => {
      useUpdateStore.setState({
        updateAvailable: true,
        latestVersion: '0.5.0',
      })

      useUpdateStore.getState().dismissUpdate()

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'opencow:update:dismissed-version',
        '0.5.0',
      )
    })

    it('handles null latestVersion gracefully', () => {
      useUpdateStore.setState({ latestVersion: null })

      useUpdateStore.getState().dismissUpdate()

      expect(useUpdateStore.getState().dismissedVersion).toBeNull()
    })
  })

  describe('checkForUpdates', () => {
    it('sets checking to true during the check', async () => {
      const promise = useUpdateStore.getState().checkForUpdates()
      expect(useUpdateStore.getState().checking).toBe(true)
      await promise
    })

    it('resets checking on error', async () => {
      checkForUpdatesMock.mockRejectedValueOnce(new Error('Network error'))

      await useUpdateStore.getState().checkForUpdates()

      expect(useUpdateStore.getState().checking).toBe(false)
    })
  })
})
