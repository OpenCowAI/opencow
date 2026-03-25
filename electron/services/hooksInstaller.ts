// SPDX-License-Identifier: Apache-2.0

import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import type { DataPaths } from '../platform/dataPaths'
import { createLogger } from '../platform/logger'
import { HOOK_MARKER_KEY } from '@shared/appIdentity'

const log = createLogger('HooksInstaller')

const CLAUDE_SETTINGS = join(homedir(), '.claude', 'settings.json')

type HookEnv = 'production' | 'development'

const HOOK_EVENTS = [
  'SessionStart',
  'Stop',
  'SessionEnd',
  'Notification',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'TaskCompleted',
  'SubagentStart',
  'SubagentStop'
]

interface ClaudeSettings {
  hooks?: Record<string, HookEntry[]>
  [key: string]: unknown
}

interface HookEntry {
  matcher?: string
  hooks: HookCommand[]
  [HOOK_MARKER_KEY]?: HookEnv | boolean
}

interface HookCommand {
  type: string
  command: string
}

function makeHookScript(eventsLogPath: string): string {
  return `#!/bin/bash
# OpenCow event logger - captures Claude Code hook events
EVENT_LOG="${eventsLogPath}"
mkdir -p "$(dirname "$EVENT_LOG")"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
INPUT=$(cat -)
echo "{\\"timestamp\\":\\"$TIMESTAMP\\",\\"payload\\":$INPUT}" >> "$EVENT_LOG"
`
}

async function readClaudeSettings(): Promise<ClaudeSettings> {
  try {
    const content = await readFile(CLAUDE_SETTINGS, 'utf-8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

async function writeClaudeSettings(settings: ClaudeSettings): Promise<void> {
  await writeFile(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2), 'utf-8')
}

export async function installHooks(paths: DataPaths, env: HookEnv): Promise<boolean> {
  try {
    // Write hook script with correct events.jsonl path for this environment
    await mkdir(paths.hooks, { recursive: true })
    await writeFile(paths.eventLogger, makeHookScript(paths.eventsLog), { mode: 0o755 })

    const settings = await readClaudeSettings()
    if (!settings.hooks) {
      settings.hooks = {}
    }

    for (const event of HOOK_EVENTS) {
      if (!settings.hooks[event]) {
        settings.hooks[event] = []
      }

      const entries = settings.hooks[event] as HookEntry[]
      const alreadyInstalled = entries.some((e) => e[HOOK_MARKER_KEY] === env)

      if (!alreadyInstalled) {
        entries.push({
          hooks: [{ type: 'command', command: paths.eventLogger }],
          [HOOK_MARKER_KEY]: env
        })
      }
    }

    await writeClaudeSettings(settings)
    return true
  } catch (err) {
    log.error(`Failed to install hooks (${env})`, err)
    return false
  }
}

export async function uninstallHooks(env: HookEnv): Promise<boolean> {
  try {
    const settings = await readClaudeSettings()
    if (!settings.hooks) return true

    for (const event of Object.keys(settings.hooks)) {
      const entries = settings.hooks[event] as HookEntry[]
      // Remove only hooks belonging to this environment
      // Also clean up legacy boolean markers (from pre-env-separation versions)
      settings.hooks[event] = entries.filter((e) => {
        const marker = e[HOOK_MARKER_KEY]
        if (marker === env) return false
        // Legacy cleanup: boolean true was the old format — remove if we're prod
        if (marker === true && env === 'production') return false
        return true
      })

      if ((settings.hooks[event] as HookEntry[]).length === 0) {
        delete settings.hooks[event]
      }
    }

    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks
    }

    await writeClaudeSettings(settings)
    return true
  } catch (err) {
    log.error(`Failed to uninstall hooks (${env})`, err)
    return false
  }
}

export async function isHooksInstalled(env: HookEnv): Promise<boolean> {
  try {
    const settings = await readClaudeSettings()
    if (!settings.hooks) return false

    return Object.values(settings.hooks).some((entries) =>
      (entries as HookEntry[]).some((e) => {
        const marker = e[HOOK_MARKER_KEY]
        if (marker === env) return true
        // Legacy boolean marker is treated as 'production'
        if (marker === true && env === 'production') return true
        return false
      })
    )
  } catch {
    return false
  }
}

/**
 * Migration helper: remove legacy Hook entries from ~/.claude/settings.json (idempotent).
 * Called on first launch after a brand migration, cleans up entries marked with the old marker key (e.g. '__ccboard__').
 *
 * @param legacyMarkerKey - Legacy marker key, e.g. '__ccboard__'
 */
export async function removeLegacyHookEntries(legacyMarkerKey: string): Promise<void> {
  try {
    const settings = await readClaudeSettings()
    if (!settings.hooks) return

    let changed = false
    for (const event of Object.keys(settings.hooks)) {
      const before = (settings.hooks[event] as HookEntry[]).length
      settings.hooks[event] = (settings.hooks[event] as HookEntry[]).filter(
        (e) => (e as unknown as Record<string, unknown>)[legacyMarkerKey] === undefined
      )
      if ((settings.hooks[event] as HookEntry[]).length !== before) changed = true
      if ((settings.hooks[event] as HookEntry[]).length === 0) {
        delete settings.hooks[event]
      }
    }
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks
    if (changed) await writeClaudeSettings(settings)
    log.info(`Legacy hook entries (${legacyMarkerKey}) removed`)
  } catch (err) {
    log.error('Failed to remove legacy hook entries', err)
    // Do not throw — hook migration failure should not block app startup
  }
}
