// SPDX-License-Identifier: Apache-2.0

import type { CapabilityScanner } from '../types'
import type { HookEventConfig, HookRuleGroup, HookRule, CapabilityScope } from '@shared/types'
import type { ResolvedPlugin } from '../pluginResolver'
import { resolveHooksFile } from '../pluginResolver'
import { safeReadFile, byName } from '../utils'
import { HOOK_MARKER_KEY } from '@shared/appIdentity'

/**
 * Hook scanner — discovers hook configurations from 3 sources:
 *
 * 1. **Settings files** — `settings.json` / `settings.local.json` (global + project)
 * 2. **Plugin hooks** — `{installPath}/hooks/hooks.json` from active plugins
 *
 * Hook events with the same name are merged (their ruleGroups are combined).
 */
export const hookScanner: CapabilityScanner<'hook'> = {
  category: 'hook',
  async scan(ctx) {
    const { paths, activePlugins } = ctx

    // Global: user settings + settings.local + plugin hooks
    const [globalSettings, globalSettingsLocal, pluginHooks] = await Promise.all([
      scanHooksFromFile(paths.globalSettings, 'global'),
      scanHooksFromFile(paths.globalSettingsLocal, 'global'),
      scanActivePluginHooks(activePlugins),
    ])
    const globalHooks = mergeHookEvents([...globalSettings, ...globalSettingsLocal, ...pluginHooks])

    // Project
    let projectHooks: HookEventConfig[] = []
    if (paths.project) {
      const [projSettings, projSettingsLocal] = await Promise.all([
        scanHooksFromFile(paths.project.settings, 'project'),
        scanHooksFromFile(paths.project.settingsLocal, 'project'),
      ])
      projectHooks = mergeHookEvents([...projSettings, ...projSettingsLocal])
    }

    return {
      global: globalHooks.sort(byName),
      project: projectHooks.sort(byName),
    }
  },
}

// ---------------------------------------------------------------------------
// Settings-file hook parsing
// ---------------------------------------------------------------------------

async function scanHooksFromFile(filePath: string, scope: CapabilityScope): Promise<HookEventConfig[]> {
  const content = await safeReadFile(filePath)
  if (!content) return []

  try {
    const settings = JSON.parse(content) as Record<string, unknown>
    const hooks = settings['hooks'] as Record<string, unknown[]> | undefined
    if (!hooks || typeof hooks !== 'object') return []

    return parseHookEvents(hooks, {
      scope,
      origin: scope === 'project' ? 'project' : 'config-file',
      sourcePath: filePath,
    })
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Plugin hook scanning
// ---------------------------------------------------------------------------

async function scanActivePluginHooks(plugins: ResolvedPlugin[]): Promise<HookEventConfig[]> {
  const results = await Promise.all(
    plugins.map(plugin => scanSinglePluginHooks(plugin))
  )
  return results.flat()
}

async function scanSinglePluginHooks(plugin: ResolvedPlugin): Promise<HookEventConfig[]> {
  const hooksJsonPath = resolveHooksFile(plugin)
  const content = await safeReadFile(hooksJsonPath)
  if (!content) return []

  try {
    const data = JSON.parse(content) as Record<string, unknown>

    // hooks.json format: { hooks: { EventName: [...] } }
    // The events are nested under a "hooks" wrapper key
    const hooksObj = data['hooks'] as Record<string, unknown[]> | undefined
    if (!hooksObj || typeof hooksObj !== 'object') return []

    return parseHookEvents(hooksObj, {
      scope: 'global',
      origin: 'plugin',
      sourcePath: hooksJsonPath,
      mount: {
        name: plugin.name,
        marketplace: plugin.marketplace,
        version: plugin.version,
      },
    })
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Shared parsing
// ---------------------------------------------------------------------------

interface HookSourceInfo {
  scope: CapabilityScope
  origin: 'config-file' | 'project' | 'plugin'
  sourcePath: string
  mount?: { name: string; marketplace: string; version: string }
}

function parseHookEvents(
  hooks: Record<string, unknown[]>,
  sourceInfo: HookSourceInfo,
): HookEventConfig[] {
  const result: HookEventConfig[] = []

  for (const [eventName, ruleGroups] of Object.entries(hooks)) {
    if (!Array.isArray(ruleGroups)) continue

    const groups: HookRuleGroup[] = []
    for (const group of ruleGroups) {
      const g = group as Record<string, unknown>
      const isManagedByApp = g[HOOK_MARKER_KEY] === true
      const matcher = g['matcher'] as string | undefined
      const innerHooks = g['hooks'] as Array<Record<string, unknown>> | undefined
      if (!Array.isArray(innerHooks)) continue

      const hookRules: HookRule[] = innerHooks.map(h => ({
        type: (h['type'] as HookRule['type']) ?? 'command',
        command: h['command'] as string | undefined,
        prompt: h['prompt'] as string | undefined,
        async: h['async'] as boolean | undefined,
      }))

      groups.push({ matcher, hooks: hookRules, isManagedByApp })
    }

    result.push({
      name: eventName,
      description: '',
      source: {
        scope: sourceInfo.scope,
        origin: sourceInfo.origin,
        sourcePath: sourceInfo.sourcePath,
        mount: sourceInfo.mount,
      },
      ruleGroups: groups,
    })
  }

  return result
}

/** Merge hook events with the same name — combines their ruleGroups */
function mergeHookEvents(events: HookEventConfig[]): HookEventConfig[] {
  const map = new Map<string, HookEventConfig>()
  for (const event of events) {
    const existing = map.get(event.name)
    if (existing) {
      existing.ruleGroups.push(...event.ruleGroups)
    } else {
      map.set(event.name, { ...event, ruleGroups: [...event.ruleGroups] })
    }
  }
  return Array.from(map.values())
}
