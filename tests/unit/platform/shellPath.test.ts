// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  getShellEnvironmentSafe,
  resolveNodeExecutableForChildProcess,
  type ShellEnvironment,
} from '../../../electron/platform/shellPath'

describe('shellPath node executable resolution', () => {
  it('returns runtime execPath in non-electron runtime', () => {
    const resolved = resolveNodeExecutableForChildProcess({
      runtime: {
        isElectronRuntime: false,
        platform: 'darwin',
        execPath: '/usr/local/bin/node',
      },
    })

    expect(resolved).toBe('/usr/local/bin/node')
  })

  it('uses shellEnv.nodeBinDir in electron runtime when binary exists', () => {
    const shellEnv: ShellEnvironment = {
      path: '/usr/bin:/bin',
      nodeBinDir: '/Users/me/.nvm/versions/node/v22.0.0/bin',
    }

    const resolved = resolveNodeExecutableForChildProcess({
      runtime: {
        isElectronRuntime: true,
        platform: 'darwin',
        execPath: '/Applications/OpenCow.app/Contents/MacOS/OpenCow',
      },
      shellEnv,
      fileExists: (filePath) => filePath === '/Users/me/.nvm/versions/node/v22.0.0/bin/node',
    })

    expect(resolved).toBe('/Users/me/.nvm/versions/node/v22.0.0/bin/node')
  })

  it('falls back to PATH scan in electron runtime when nodeBinDir is missing', () => {
    const shellEnv: ShellEnvironment = {
      path: '/opt/homebrew/bin:/usr/bin:/bin',
      nodeBinDir: null,
    }

    const resolved = resolveNodeExecutableForChildProcess({
      runtime: {
        isElectronRuntime: true,
        platform: 'darwin',
        execPath: '/Applications/OpenCow.app/Contents/MacOS/OpenCow',
      },
      shellEnv,
      fileExists: (filePath) => filePath === '/opt/homebrew/bin/node',
    })

    expect(resolved).toBe('/opt/homebrew/bin/node')
  })

  it('uses win32 PATH delimiter and node.exe binary name', () => {
    const shellEnv: ShellEnvironment = {
      path: 'C:\\Node\\bin;C:\\Windows\\System32',
      nodeBinDir: null,
    }

    const resolved = resolveNodeExecutableForChildProcess({
      runtime: {
        isElectronRuntime: true,
        platform: 'win32',
        execPath: 'C:\\Program Files\\OpenCow\\OpenCow.exe',
      },
      shellEnv,
      fileExists: (filePath) => filePath === 'C:\\Node\\bin/node.exe',
    })

    expect(resolved).toBe('C:\\Node\\bin/node.exe')
  })

  it('returns null when electron runtime cannot resolve a node binary', () => {
    const shellEnv: ShellEnvironment = {
      path: '/usr/bin:/bin',
      nodeBinDir: null,
    }

    const resolved = resolveNodeExecutableForChildProcess({
      runtime: {
        isElectronRuntime: true,
        platform: 'darwin',
        execPath: '/Applications/OpenCow.app/Contents/MacOS/OpenCow',
      },
      shellEnv,
      fileExists: () => false,
    })

    expect(resolved).toBeNull()
  })
})

describe('getShellEnvironmentSafe', () => {
  it('returns a safe shell env shape even when initShellEnvironment was not called', () => {
    const shellEnv = getShellEnvironmentSafe()
    expect(typeof shellEnv.path).toBe('string')
    expect(shellEnv).toHaveProperty('nodeBinDir')
  })
})
