// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { sanitizeChildProcessEnv } from '../../../electron/command/sessionOrchestrator'

describe('sanitizeChildProcessEnv', () => {
  it('removes ELECTRON_ prefixed env vars', () => {
    const env: Record<string, string> = {
      HOME: '/home/user',
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_EXEC_PATH: '/app/electron',
      ELECTRON_CLI_ARGS: '--some-flag',
      ELECTRON_MAJOR_VER: '33',
      PATH: '/usr/bin',
    }
    const removed = sanitizeChildProcessEnv(env)
    expect(removed).toContain('ELECTRON_RUN_AS_NODE')
    expect(removed).toContain('ELECTRON_EXEC_PATH')
    expect(removed).toContain('ELECTRON_CLI_ARGS')
    expect(removed).toContain('ELECTRON_MAJOR_VER')
    expect(env).toEqual({ HOME: '/home/user', PATH: '/usr/bin' })
  })

  it('removes NODE_OPTIONS env var', () => {
    const env: Record<string, string> = {
      HOME: '/home/user',
      NODE_OPTIONS: '--require /path/to/asar-node.js --no-deprecation',
      NODE_ENV: 'production',
      PATH: '/usr/bin',
    }
    const removed = sanitizeChildProcessEnv(env)
    expect(removed).toContain('NODE_OPTIONS')
    // NODE_ENV should NOT be removed (it's a standard env var)
    expect(env.NODE_ENV).toBe('production')
    expect(env.NODE_OPTIONS).toBeUndefined()
  })

  it('removes NODE_CHANNEL_FD env var', () => {
    const env: Record<string, string> = {
      NODE_CHANNEL_FD: '3',
      HOME: '/home/user',
    }
    const removed = sanitizeChildProcessEnv(env)
    expect(removed).toContain('NODE_CHANNEL_FD')
    expect(env.NODE_CHANNEL_FD).toBeUndefined()
    expect(env.HOME).toBe('/home/user')
  })

  it('removes Electron-related exact match vars', () => {
    const env: Record<string, string> = {
      NODE_ENV_ELECTRON_VITE: 'production',
      ORIGINAL_XDG_CURRENT_DESKTOP: 'GNOME',
      CHROME_DESKTOP: 'opencow.desktop',
      GOOGLE_API_KEY: 'some-key',
      GOOGLE_DEFAULT_CLIENT_ID: 'some-id',
      GOOGLE_DEFAULT_CLIENT_SECRET: 'some-secret',
      HOME: '/home/user',
    }
    const removed = sanitizeChildProcessEnv(env)
    expect(removed).toHaveLength(6)
    expect(env).toEqual({ HOME: '/home/user' })
  })

  it('preserves standard env vars', () => {
    const env: Record<string, string> = {
      HOME: '/home/user',
      USER: 'user',
      SHELL: '/bin/zsh',
      PATH: '/usr/bin:/usr/local/bin',
      LANG: 'en_US.UTF-8',
      TMPDIR: '/tmp',
      NODE_ENV: 'production',
      CODEX_API_KEY: 'sk-test',
      ANTHROPIC_API_KEY: 'sk-ant-test',
    }
    const removed = sanitizeChildProcessEnv(env)
    expect(removed).toHaveLength(0)
    expect(Object.keys(env)).toHaveLength(9)
  })

  it('handles empty env gracefully', () => {
    const env: Record<string, string> = {}
    const removed = sanitizeChildProcessEnv(env)
    expect(removed).toHaveLength(0)
    expect(env).toEqual({})
  })

  it('handles mixed: keeps valid, removes invalid env vars', () => {
    const env: Record<string, string> = {
      HOME: '/home/user',
      PATH: '/usr/bin',
      SHELL: '/bin/zsh',
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_EXEC_PATH: '/app/electron',
      NODE_OPTIONS: '--require /electron/asar.js',
      NODE_ENV: 'production',
      NODE_ENV_ELECTRON_VITE: 'dev',
      CODEX_API_KEY: 'sk-test',
      ANTHROPIC_API_KEY: 'sk-ant',
      OPENCOW_CODEX_BRIDGE_URL: 'http://127.0.0.1:1234',
    }
    const removed = sanitizeChildProcessEnv(env)
    expect(removed).toContain('ELECTRON_RUN_AS_NODE')
    expect(removed).toContain('ELECTRON_EXEC_PATH')
    expect(removed).toContain('NODE_OPTIONS')
    expect(removed).toContain('NODE_ENV_ELECTRON_VITE')
    expect(removed).toHaveLength(4)
    // Verify remaining keys are preserved
    expect(env).toEqual({
      HOME: '/home/user',
      PATH: '/usr/bin',
      SHELL: '/bin/zsh',
      NODE_ENV: 'production',
      CODEX_API_KEY: 'sk-test',
      ANTHROPIC_API_KEY: 'sk-ant',
      OPENCOW_CODEX_BRIDGE_URL: 'http://127.0.0.1:1234',
    })
  })
})
