// SPDX-License-Identifier: Apache-2.0

import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

// ── Public types ─────────────────────────────────────────────────────

/**
 * Immutable snapshot of the resolved shell environment.
 *
 * Created once at startup by `initShellEnvironment()`, then frozen.
 * Consumers read this via `getShellEnvironment()` — the result is
 * immune to any later `process.env.PATH` mutations.
 */
export interface ShellEnvironment {
  /** Full resolved PATH string (suitable for child_process env). */
  readonly path: string
  /** Directory containing the `node` binary (e.g. `~/.nvm/versions/node/v24.13.1/bin`), or `null` if not found. */
  readonly nodeBinDir: string | null
}

export interface NodeRuntimeIdentity {
  /** True when running inside Electron runtime. */
  readonly isElectronRuntime: boolean
  readonly platform: NodeJS.Platform
  readonly execPath: string
}

export interface ResolveNodeExecutableForChildProcessInput {
  /** Optional shell environment override (primarily for tests). */
  readonly shellEnv?: ShellEnvironment | null
  /** Optional runtime override (primarily for tests). */
  readonly runtime?: NodeRuntimeIdentity
  /** Optional existence probe override (primarily for tests). */
  readonly fileExists?: (filePath: string) => boolean
}

// ── Module state ─────────────────────────────────────────────────────

let shellEnv: ShellEnvironment | undefined

// ── Public API ───────────────────────────────────────────────────────

/**
 * Resolves and caches the shell environment for macOS Electron.
 *
 * Electron on macOS launches with a minimal PATH (`/usr/bin:/bin`) that doesn't
 * include `node` from nvm / fnm / Homebrew / Volta. This function resolves the
 * full PATH and the absolute location of `node`, then freezes the result.
 *
 * **Must be called once at startup, before `app.whenReady()`.**
 *
 * Resolution strategy (each step only runs if previous didn't find `node`):
 *   1. Non-interactive login shell (`-lc`) — fast, reads `.zprofile`
 *   2. Verify `node` is reachable in the resolved PATH
 *   3. Interactive login shell (`-ilc`) — slower, reads `.zshrc` (nvm/fnm init)
 *   4. Probe well-known directories: Homebrew → nvm → fnm → Volta
 *   5. Prepend discovered `node` directory to PATH
 */
export function initShellEnvironment(): void {
  if (process.platform !== 'darwin') {
    shellEnv = Object.freeze({
      path: process.env.PATH || '',
      nodeBinDir: null,
    })
    return
  }

  // Step 1: Resolve PATH from login shell (or fall back to known paths).
  let path = resolveLoginShellPath() ?? buildFallbackPath()

  // Step 2: Locate `node` — first scan PATH, then probe known locations.
  const nodeBinDir = scanPathForNode(path) ?? findNodeBinDir()

  // Step 3: If found outside current PATH, prepend it.
  if (nodeBinDir && !scanPathForNode(path)) {
    path = `${nodeBinDir}:${path}`
  }

  // Commit to process.env so other child_process consumers benefit.
  process.env.PATH = path

  // Freeze — no one can mutate this after init.
  shellEnv = Object.freeze({ path, nodeBinDir })

  if (!nodeBinDir) {
    console.warn(
      '[ShellEnv] node binary not found in any known location. ' +
      'Claude Code sessions will fail to start. ' +
      'Ensure node is installed via nvm, fnm, Homebrew, or Volta.',
    )
  }
}

/**
 * Returns the frozen shell environment resolved at startup.
 *
 * @throws if called before `initShellEnvironment()`.
 */
export function getShellEnvironment(): ShellEnvironment {
  if (!shellEnv) {
    throw new Error(
      'Shell environment not initialized. Call initShellEnvironment() in main.ts before using this.',
    )
  }
  return shellEnv
}

/**
 * Runtime-safe shell environment lookup.
 *
 * Returns the initialized shell environment when available; otherwise
 * falls back to current process PATH and unknown node location.
 */
export function getShellEnvironmentSafe(): ShellEnvironment {
  try {
    return getShellEnvironment()
  } catch {
    return {
      path: process.env.PATH || '',
      nodeBinDir: null,
    }
  }
}

function getDefaultNodeRuntimeIdentity(): NodeRuntimeIdentity {
  return {
    isElectronRuntime:
      typeof process.versions.electron === 'string' && process.versions.electron.length > 0,
    platform: process.platform,
    execPath: process.execPath,
  }
}

/**
 * Resolve the executable command used to launch Node child processes.
 *
 * - Non-Electron runtime: `process.execPath` is already the Node binary.
 * - Electron runtime: prefers absolute Node path from shellEnv.nodeBinDir,
 *   then PATH scan; returns null when unresolved.
 */
export function resolveNodeExecutableForChildProcess(
  input: ResolveNodeExecutableForChildProcessInput = {},
): string | null {
  const runtime = input.runtime ?? getDefaultNodeRuntimeIdentity()
  if (!runtime.isElectronRuntime) {
    return runtime.execPath
  }

  const shell = input.shellEnv ?? getShellEnvironmentSafe()
  const fileExists = input.fileExists ?? existsSync
  const nodeBinaryName = runtime.platform === 'win32' ? 'node.exe' : 'node'

  const candidates: string[] = []
  if (shell.nodeBinDir) {
    candidates.push(join(shell.nodeBinDir, nodeBinaryName))
  }

  const scannedNodeDir = scanPathForNode(shell.path, runtime.platform, fileExists)
  if (scannedNodeDir) {
    const scannedPath = join(scannedNodeDir, nodeBinaryName)
    if (!candidates.includes(scannedPath)) {
      candidates.push(scannedPath)
    }
  }

  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate
  }
  return null
}

// ── Backward-compat aliases (will be removed in a future cleanup) ────

/** @deprecated Use `initShellEnvironment()` instead. */
export const fixElectronPath = initShellEnvironment

/** @deprecated Use `getShellEnvironment().path` instead. */
export function getResolvedPath(): string {
  return getShellEnvironment().path
}

// ── Internal: PATH resolution ────────────────────────────────────────

/**
 * Attempt to get the full PATH from a non-interactive login shell.
 *
 * On zsh this sources `/etc/zprofile` + `~/.zprofile` but NOT `~/.zshrc`,
 * so node managers initialised in `.zshrc` won't be picked up here.
 */
function resolveLoginShellPath(): string | null {
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const raw = execSync(`${shell} -lc 'echo $PATH'`, {
      encoding: 'utf-8',
      timeout: 5_000,
    }).trim()

    // Guard against shell noise: take only the last non-empty line.
    const lines = raw.split('\n').filter(Boolean)
    const result = lines[lines.length - 1] ?? ''

    return result.includes('/') ? result : null
  } catch {
    return null
  }
}

// ── Internal: Node discovery ─────────────────────────────────────────

/** O(n) scan: return the first PATH entry that contains a `node` binary. */
function scanPathForNode(
  pathStr: string,
  platform: NodeJS.Platform = process.platform,
  fileExists: (filePath: string) => boolean = existsSync,
): string | null {
  const delimiter = platform === 'win32' ? ';' : ':'
  const nodeBinaryName = platform === 'win32' ? 'node.exe' : 'node'
  for (const dir of pathStr.split(delimiter)) {
    if (dir && fileExists(join(dir, nodeBinaryName))) return dir
  }
  return null
}

/**
 * Multi-strategy search for the directory containing `node`.
 *
 * Order: interactive shell → Homebrew → nvm → fnm → Volta
 */
function findNodeBinDir(): string | null {
  return (
    findViaInteractiveShell() ??
    findInWellKnownPaths() ??
    findViaNvm() ??
    findViaFnm() ??
    findViaVolta()
  )
}

/** Strategy 1: Interactive login shell (loads `.zshrc` where nvm/fnm init lives). */
function findViaInteractiveShell(): string | null {
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const raw = execSync(`${shell} -ilc 'command -v node 2>/dev/null'`, {
      encoding: 'utf-8',
      timeout: 8_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()

    const lastLine = raw.split('\n').filter(Boolean).pop() ?? ''
    if (lastLine.startsWith('/') && existsSync(lastLine)) {
      return dirname(lastLine)
    }
  } catch { /* timeout or shell error */ }
  return null
}

/** Strategy 2: Well-known Homebrew / system paths. */
function findInWellKnownPaths(): string | null {
  for (const dir of ['/opt/homebrew/bin', '/usr/local/bin']) {
    if (existsSync(join(dir, 'node'))) return dir
  }
  return null
}

/** Strategy 3: nvm — resolve default version's bin directory. */
function findViaNvm(): string | null {
  const nvmDir = process.env.NVM_DIR || join(homedir(), '.nvm')
  return resolveNvmNodeBin(nvmDir)
}

/** Strategy 4: fnm (Fast Node Manager). */
function findViaFnm(): string | null {
  for (const base of [
    join(homedir(), '.local', 'share', 'fnm'),
    join(homedir(), 'Library', 'Application Support', 'fnm'),
  ]) {
    const d = join(base, 'aliases', 'default', 'bin')
    if (existsSync(join(d, 'node'))) return d
  }
  return null
}

/** Strategy 5: Volta. */
function findViaVolta(): string | null {
  const voltaBin = join(homedir(), '.volta', 'bin')
  return existsSync(join(voltaBin, 'node')) ? voltaBin : null
}

// ── Internal: nvm resolution ─────────────────────────────────────────

/**
 * Resolve the `bin` directory for nvm's default Node.js version.
 *
 * Checks (in order):
 *   1. `$NVM_DIR/current/bin`  — some setups create this symlink
 *   2. `$NVM_DIR/alias/default` → match against installed versions
 *   3. Latest installed version  — ultimate fallback
 */
function resolveNvmNodeBin(nvmDir: string): string | null {
  try {
    // 1. `current` symlink (created by some nvm wrappers / Docker images)
    const currentBin = join(nvmDir, 'current', 'bin')
    if (existsSync(join(currentBin, 'node'))) return currentBin

    // 2. Read the default alias file
    const versionsDir = join(nvmDir, 'versions', 'node')
    if (!existsSync(versionsDir)) return null

    const versions = readdirSync(versionsDir)
      .filter(v => v.startsWith('v'))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))

    let defaultPrefix = ''
    try {
      defaultPrefix = readFileSync(join(nvmDir, 'alias', 'default'), 'utf-8').trim()
    } catch { /* no default alias */ }

    if (defaultPrefix) {
      const norm = defaultPrefix.startsWith('v') ? defaultPrefix : `v${defaultPrefix}`
      for (const v of versions) {
        if (v === norm || v.startsWith(`${norm}.`)) {
          const binDir = join(versionsDir, v, 'bin')
          if (existsSync(join(binDir, 'node'))) return binDir
        }
      }
    }

    // 3. Fallback: latest installed version
    for (const v of versions) {
      const binDir = join(versionsDir, v, 'bin')
      if (existsSync(join(binDir, 'node'))) return binDir
    }
  } catch { /* nvm not installed or broken */ }

  return null
}

// ── Internal: fallback PATH ──────────────────────────────────────────

/** Builds a fallback PATH when login-shell resolution fails entirely. */
function buildFallbackPath(): string {
  const nvmDir = process.env.NVM_DIR || join(homedir(), '.nvm')
  const extra = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    join(nvmDir, 'current', 'bin'),
    join(homedir(), '.local', 'share', 'fnm', 'aliases', 'default', 'bin'),
    join(homedir(), '.volta', 'bin'),
  ]

  // Also try to resolve nvm's actual versioned bin dir (handles case where
  // `current` symlink doesn't exist but installed versions do).
  const nvmBin = resolveNvmNodeBin(nvmDir)
  if (nvmBin) extra.unshift(nvmBin)

  return [process.env.PATH || '', ...extra].join(':')
}
