// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFile, writeFile, mkdir } from 'fs/promises'
import type { DataPaths } from '../../../electron/platform/dataPaths'

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn()
}))

const mockedReadFile = vi.mocked(readFile)
const mockedWriteFile = vi.mocked(writeFile)
const mockedMkdir = vi.mocked(mkdir)

// Import after mocking
const { installHooks, uninstallHooks, isHooksInstalled } = await import(
  '../../../electron/services/hooksInstaller'
)

const testPaths: DataPaths = {
  root: '/tmp/test-opencow',
  hooks: '/tmp/test-opencow/hooks',
  eventLogger: '/tmp/test-opencow/hooks/event-logger.sh',
  eventsLog: '/tmp/test-opencow/events.jsonl',
  database: '/tmp/test-opencow/app.db',
  settings: '/tmp/test-opencow/settings.json',
  onboarding: '/tmp/test-opencow/onboarding.json',
}

describe('hooksInstaller', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedMkdir.mockResolvedValue(undefined)
    mockedWriteFile.mockResolvedValue(undefined)
  })

  describe('installHooks', () => {
    it('creates hooks in empty settings', async () => {
      mockedReadFile.mockResolvedValue('{}')

      const result = await installHooks(testPaths, 'production')

      expect(result).toBe(true)
      expect(mockedWriteFile).toHaveBeenCalledTimes(2) // script + settings

      // Verify settings were written with hooks
      const settingsCall = mockedWriteFile.mock.calls.find((c) =>
        (c[0] as string).includes('settings.json')
      )
      expect(settingsCall).toBeDefined()

      const written = JSON.parse(settingsCall![1] as string)
      expect(written.hooks).toBeDefined()
      expect(written.hooks.SessionStart).toBeDefined()
      expect(written.hooks.Stop).toBeDefined()
      expect(written.hooks.Notification).toBeDefined()

      // Verify marker is environment string, not boolean
      expect(written.hooks.SessionStart[0].__opencow__).toBe('production')
    })

    it('preserves existing settings', async () => {
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          enabledPlugins: { test: true },
          hooks: {
            SessionStart: [{ hooks: [{ type: 'command', command: 'echo hi' }] }]
          }
        })
      )

      await installHooks(testPaths, 'production')

      const settingsCall = mockedWriteFile.mock.calls.find((c) =>
        (c[0] as string).includes('settings.json')
      )
      const written = JSON.parse(settingsCall![1] as string)

      // Existing plugin preserved
      expect(written.enabledPlugins).toEqual({ test: true })
      // Existing hook preserved + OpenCow hook added
      expect(written.hooks.SessionStart).toHaveLength(2)
    })

    it('does not duplicate hooks on re-install', async () => {
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [{ type: 'command', command: 'test' }], __opencow__: 'production' }]
          }
        })
      )

      await installHooks(testPaths, 'production')

      const settingsCall = mockedWriteFile.mock.calls.find((c) =>
        (c[0] as string).includes('settings.json')
      )
      const written = JSON.parse(settingsCall![1] as string)
      expect(written.hooks.SessionStart).toHaveLength(1)
    })

    it('allows dev and prod hooks to coexist', async () => {
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [{ type: 'command', command: 'prod-logger' }], __opencow__: 'production' }]
          }
        })
      )

      await installHooks(testPaths, 'development')

      const settingsCall = mockedWriteFile.mock.calls.find((c) =>
        (c[0] as string).includes('settings.json')
      )
      const written = JSON.parse(settingsCall![1] as string)
      // Both prod and dev hooks should coexist
      expect(written.hooks.SessionStart).toHaveLength(2)
      expect(written.hooks.SessionStart[0].__opencow__).toBe('production')
      expect(written.hooks.SessionStart[1].__opencow__).toBe('development')
    })

    it('writes hook script with correct eventsLog path', async () => {
      mockedReadFile.mockResolvedValue('{}')

      await installHooks(testPaths, 'production')

      const scriptCall = mockedWriteFile.mock.calls.find((c) =>
        (c[0] as string).includes('event-logger.sh')
      )
      expect(scriptCall).toBeDefined()
      const scriptContent = scriptCall![1] as string
      expect(scriptContent).toContain(testPaths.eventsLog)
    })
  })

  describe('uninstallHooks', () => {
    it('removes only hooks for the specified environment', async () => {
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          hooks: {
            SessionStart: [
              { hooks: [{ type: 'command', command: 'user-hook' }] },
              { hooks: [{ type: 'command', command: 'prod' }], __opencow__: 'production' },
              { hooks: [{ type: 'command', command: 'dev' }], __opencow__: 'development' }
            ]
          }
        })
      )

      const result = await uninstallHooks('production')

      expect(result).toBe(true)

      const settingsCall = mockedWriteFile.mock.calls[0]
      const written = JSON.parse(settingsCall![1] as string)
      expect(written.hooks.SessionStart).toHaveLength(2)
      // User hook and dev hook remain
      expect(written.hooks.SessionStart[0].__opencow__).toBeUndefined()
      expect(written.hooks.SessionStart[1].__opencow__).toBe('development')
    })

    it('cleans up legacy boolean markers when uninstalling production', async () => {
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [{ type: 'command', command: 'opencow' }], __opencow__: true }]
          }
        })
      )

      await uninstallHooks('production')

      const settingsCall = mockedWriteFile.mock.calls[0]
      const written = JSON.parse(settingsCall![1] as string)
      expect(written.hooks).toBeUndefined()
    })

    it('cleans up empty hook arrays', async () => {
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [{ type: 'command', command: 'opencow' }], __opencow__: 'production' }]
          }
        })
      )

      await uninstallHooks('production')

      const settingsCall = mockedWriteFile.mock.calls[0]
      const written = JSON.parse(settingsCall![1] as string)
      expect(written.hooks).toBeUndefined()
    })
  })

  describe('isHooksInstalled', () => {
    it('returns true when hooks for specified env exist', async () => {
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [], __opencow__: 'production' }]
          }
        })
      )

      expect(await isHooksInstalled('production')).toBe(true)
    })

    it('returns true for legacy boolean marker when checking production', async () => {
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [], __opencow__: true }]
          }
        })
      )

      expect(await isHooksInstalled('production')).toBe(true)
    })

    it('returns false when no hooks', async () => {
      mockedReadFile.mockResolvedValue('{}')
      expect(await isHooksInstalled('production')).toBe(false)
    })

    it('returns false when only user hooks', async () => {
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [{ type: 'command', command: 'user' }] }]
          }
        })
      )

      expect(await isHooksInstalled('production')).toBe(false)
    })

    it('returns false when only other env hooks exist', async () => {
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [], __opencow__: 'development' }]
          }
        })
      )

      expect(await isHooksInstalled('production')).toBe(false)
    })
  })
})
