// SPDX-License-Identifier: Apache-2.0

import { app } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { mkdir } from 'fs/promises'
import { APP_FS_NAME, APP_ENV_VAR } from '@shared/appIdentity'

/**
 * Whether the current process is running in development mode.
 *
 * Resolution order:
 *  1. `OPENCOW_ENV` environment variable (`development` | `production`)
 *  2. `app.isPackaged` (false in electron-vite dev, true in packaged .app)
 */
export function isDev(): boolean {
  const envOverride = process.env[APP_ENV_VAR]
  if (envOverride === 'development') return true
  if (envOverride === 'production') return false
  return !app.isPackaged
}

/**
 * Complete inventory of all file-system paths OpenCow manages.
 * Every persistent file the app reads or writes MUST be listed here.
 */
export interface DataPaths {
  /** Root data directory: `~/.opencow` (prod) or `~/.opencow-dev` (dev) */
  readonly root: string
  /** Hook scripts directory */
  readonly hooks: string
  /** Hook event logger script */
  readonly eventLogger: string
  /** Hook events JSONL (written by external hook scripts, read by OpenCow) */
  readonly eventsLog: string
  /** SQLite database */
  readonly database: string
  /** App settings JSON */
  readonly settings: string
  /** Onboarding state JSON */
  readonly onboarding: string
  /** Log files directory */
  readonly logs: string
  /** Encrypted credentials file (OS keychain-backed) */
  readonly credentials: string
  /**
   * Legacy encrypted credentials for the removed Codex engine
   * (OpenCow <= 0.3.21). Read-only — the one-shot Phase B.3d migration
   * copies its contents into the main credentials store at profile-
   * scoped keys. New writes never land here.
   */
  readonly legacyCodexCredentials: string
  /** Global capability store root: ~/.opencow/capabilities/ */
  readonly capabilities: string
  /** Encrypted credentials for repo sources (OS keychain-backed) */
  readonly repoSourceCredentials: string
  /** Encrypted credentials for issue providers (GitHub/GitLab tokens) */
  readonly issueProviderCredentials: string
}

export function resolveDataPaths(): DataPaths {
  const suffix = isDev() ? '-dev' : ''
  const root = join(homedir(), `.${APP_FS_NAME}${suffix}`)
  const hooks = join(root, 'hooks')
  return Object.freeze({
    root,
    hooks,
    eventLogger: join(hooks, 'event-logger.sh'),
    eventsLog: join(root, 'events.jsonl'),
    database: join(root, 'db', 'app.db'),    // ← brand-agnostic, permanently stable
    settings: join(root, 'settings.json'),
    onboarding: join(root, 'onboarding.json'),
    logs: join(root, 'logs'),
    credentials: join(root, 'credentials.enc'),
    legacyCodexCredentials: join(root, 'credentials-codex.enc'),
    capabilities: join(root, 'capabilities'),
    repoSourceCredentials: join(root, 'repo-credentials.enc'),
    issueProviderCredentials: join(root, 'issue-provider-credentials.enc'),
  })
}

/** Resolve project-level capability store path: `{project}/.opencow[-dev]/` (no `capabilities/` subdirectory) */
export function resolveProjectCapabilitiesPath(projectPath: string): string {
  const suffix = isDev() ? '-dev' : ''
  return join(projectPath, `.${APP_FS_NAME}${suffix}`)
}

/**
 * The 6 managed capability category subdirectory names.
 * Shared between directory creation, store listing, and file watchers.
 */
export const CAPABILITY_SUBDIRS = [
  'skills',
  'agents',
  'commands',
  'rules',
  'hooks',
  'mcp-servers',
] as const

/**
 * Ensure the global capability store directory structure exists.
 * Idempotent — safe to call on every startup.
 */
export async function ensureCapabilityDirs(capabilitiesRoot: string): Promise<void> {
  await Promise.all(
    CAPABILITY_SUBDIRS.map((sub) => mkdir(join(capabilitiesRoot, sub), { recursive: true })),
  )
}

/** Singleton — resolved once at module load, used only in main.ts */
export const dataPaths = resolveDataPaths()
