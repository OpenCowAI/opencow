// SPDX-License-Identifier: Apache-2.0

/**
 * Asar-aware child process spawning for Electron.
 *
 * Problem: child processes spawned with the system `node` binary cannot read
 * from Electron's virtual `app.asar` filesystem. This breaks `require()` for
 * any module still inside the asar archive.
 *
 * Solution (packaged app only): spawn child processes using the Electron
 * Helper binary with `ELECTRON_RUN_AS_NODE=1`. The Helper binary:
 * - Behaves as standard Node.js with native asar support
 * - Has `LSBackgroundOnly` in its Info.plist, preventing macOS Dock icons
 *
 * In dev mode there is no asar — system `node` is used directly.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { app } from 'electron'
import type { SpawnOptions, SpawnedProcess } from '@opencow-ai/opencow-agent-sdk'
import { resolveNodeExecutableForChildProcess } from './shellPath'

/**
 * Resolve the Electron Helper binary path for the packaged app.
 *
 * Electron ships helper binaries at:
 *   {app}.app/Contents/Frameworks/{name} Helper.app/Contents/MacOS/{name} Helper
 *
 * These helpers have `LSBackgroundOnly` in their Info.plist — macOS never
 * shows a Dock icon for them, unlike the main binary. They fully support
 * `ELECTRON_RUN_AS_NODE=1` for asar-aware Node.js mode.
 *
 * On non-macOS platforms, falls back to `process.execPath`.
 */
function resolveElectronHelperPath(): string {
  if (process.platform === 'darwin') {
    // process.execPath: /path/to/App.app/Contents/MacOS/AppName
    const appName = path.basename(process.execPath)
    const contentsDir = path.resolve(process.execPath, '..', '..')
    const helperPath = path.join(
      contentsDir, 'Frameworks', `${appName} Helper.app`, 'Contents', 'MacOS', `${appName} Helper`,
    )
    if (existsSync(helperPath)) return helperPath
  }
  // Non-macOS or helper not found — fall back to main binary
  return process.execPath
}

/**
 * Resolve the Node-compatible command for spawning child processes.
 *
 * - **Packaged macOS**: returns the Electron Helper binary (no Dock icon).
 * - **Packaged other OS**: returns `process.execPath`.
 *   Both must be paired with `ELECTRON_RUN_AS_NODE=1`.
 * - **Dev mode**: returns the system `node` from PATH. No asar handling
 *   needed; avoids spawning the Electron binary.
 * - **Non-Electron** (vitest): returns `process.execPath` (already Node).
 */
export function getElectronAsNodePath(): string {
  if (app.isPackaged) return resolveElectronHelperPath()
  return resolveNodeExecutableForChildProcess() ?? process.execPath
}

/**
 * Whether the current runtime requires `ELECTRON_RUN_AS_NODE=1` for
 * child processes to have asar support. Only true in packaged Electron apps.
 */
export function needsAsarBridge(): boolean {
  return app.isPackaged
}

/**
 * Build the env overlay for a child process. In packaged builds, merges
 * `ELECTRON_RUN_AS_NODE=1` so the Electron binary runs as Node with asar
 * support. In dev mode the env is returned as-is (system node needs no flag).
 */
export function buildAsarAwareEnv<T extends Record<string, string | undefined>>(baseEnv: T): T & { ELECTRON_RUN_AS_NODE?: '1' } {
  if (!needsAsarBridge()) return baseEnv
  return { ...baseEnv, ELECTRON_RUN_AS_NODE: '1' as const }
}

export interface AsarAwareSpawnOptions {
  /**
   * Callback for stderr output lines from the child process.
   *
   * This MUST be attached here (rather than by the caller after spawn)
   * because the SDK's `spawnClaudeCodeProcess` callback returns a
   * SpawnedProcess — the caller never gets a reference to the child.
   * The SDK only attaches its own stderr listener when `options.stderr`
   * is set, which we intentionally avoid to prevent double-handling.
   */
  onStderr?: (line: string) => void
}

/**
 * Create a spawn function that conforms to the Claude Agent SDK's
 * `spawnClaudeCodeProcess` interface.
 *
 * - **Packaged macOS**: spawns Helper binary (no Dock icon) with asar flag.
 * - **Packaged other**: spawns main binary with `ELECTRON_RUN_AS_NODE=1`.
 * - **Dev**: spawns the system `node` binary — no Dock icon, no asar flag.
 */
export function createAsarAwareSpawnFn(
  options: AsarAwareSpawnOptions = {},
): (spawnOpts: SpawnOptions) => SpawnedProcess {
  const command = getElectronAsNodePath()

  return (spawnOpts: SpawnOptions): SpawnedProcess => {
    // Node's ChildProcess is a structural superset of the SDK's SpawnedProcess
    // interface (stdin: Writable, stdout: Readable, killed, exitCode, kill, on).
    // stdio: 'pipe' guarantees stdin/stdout/stderr are non-null Streams.
    const child = spawn(command, spawnOpts.args, {
      cwd: spawnOpts.cwd,
      env: buildAsarAwareEnv(spawnOpts.env),
      signal: spawnOpts.signal,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }) as unknown as SpawnedProcess

    if (options.onStderr) {
      const stderr = (child as unknown as { stderr: NodeJS.ReadableStream }).stderr
      stderr.setEncoding?.('utf-8')
      stderr.on('data', (chunk: string) => {
        for (const line of chunk.split('\n')) {
          const trimmed = line.trimEnd()
          if (trimmed) options.onStderr!(trimmed)
        }
      })
    }

    return child
  }
}
