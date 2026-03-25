// SPDX-License-Identifier: Apache-2.0

/**
 * Plugin Resolver — the single source of truth for installed plugin discovery.
 *
 * Responsibilities:
 * 1. Parse `installed_plugins.json` (Record<compositeKey, InstallInfo[]>)
 * 2. Parse `settings.json` `enabledPlugins` (Record<compositeKey, boolean>)
 * 3. Parse `blocklist.json` ({plugins: [{plugin: compositeKey}]})
 * 4. Output a list of `ResolvedPlugin` objects with identity, status, and path info
 * 5. Provide `resolveCapabilityDirs()` — encapsulates convention-over-configuration
 *
 * Every scanner consumes `ResolvedPlugin[]` instead of independently traversing
 * the plugin cache directory.  This eliminates the DRY violation where 4 scanners
 * each maintained (incorrect) copies of the same traversal logic.
 */

import path from 'node:path'
import { safeReadJson, safeDirEntries } from './utils'
import type { ClaudeCodePaths } from './paths'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parsed composite key: `"superpowers@claude-plugins-official"` */
interface PluginIdentity {
  pluginName: string
  marketplace: string
  compositeKey: string
}

/** Raw install info entry from installed_plugins.json */
interface RawInstallInfo {
  scope?: string
  installPath?: string
  version?: string
}

/** Plugin manifest from `.claude-plugin/plugin.json` */
export interface PluginManifest {
  name?: string
  description?: string
  author?: { name?: string }
  skills?: string[]
  commands?: string[]
  agents?: string[]
  [key: string]: unknown
}

/** A fully resolved plugin ready for consumption by scanners */
export interface ResolvedPlugin {
  /** Plugin name extracted from composite key (e.g. "superpowers") */
  name: string
  /** Marketplace name (e.g. "claude-plugins-official") */
  marketplace: string
  /** Original composite key (e.g. "superpowers@claude-plugins-official") */
  compositeKey: string
  /** Installed version string */
  version: string
  /** Absolute path to the versioned install directory */
  installPath: string
  /** Whether the user has enabled this plugin */
  enabled: boolean
  /** Whether this plugin appears on the blocklist */
  blocked: boolean
  /** Install scope (e.g. "user", "project") */
  installScope: string
  /** Parsed plugin manifest (null if plugin.json is missing/invalid) */
  manifest: PluginManifest | null
}

// ---------------------------------------------------------------------------
// Composite key parsing
// ---------------------------------------------------------------------------

function parseCompositeKey(key: string): PluginIdentity {
  const atIndex = key.indexOf('@')
  if (atIndex === -1) {
    return { pluginName: key, marketplace: '', compositeKey: key }
  }
  return {
    pluginName: key.slice(0, atIndex),
    marketplace: key.slice(atIndex + 1),
    compositeKey: key,
  }
}

// ---------------------------------------------------------------------------
// Manifest loading
// ---------------------------------------------------------------------------

async function loadManifest(installPath: string): Promise<PluginManifest | null> {
  const manifestPath = path.join(installPath, '.claude-plugin', 'plugin.json')
  const raw = await safeReadJson(manifestPath)
  // safeReadJson returns {} on failure — distinguish from valid empty manifest
  return Object.keys(raw).length === 0 ? null : (raw as PluginManifest)
}

// ---------------------------------------------------------------------------
// Core resolver
// ---------------------------------------------------------------------------

export async function resolvePlugins(paths: ClaudeCodePaths): Promise<ResolvedPlugin[]> {
  // 1. Parse enabled plugins: Record<compositeKey, boolean>
  const settings = await safeReadJson(paths.globalSettings)
  const enabledRaw = settings['enabledPlugins']
  const enabledMap: Record<string, boolean> =
    enabledRaw && typeof enabledRaw === 'object' && !Array.isArray(enabledRaw)
      ? (enabledRaw as Record<string, boolean>)
      : {}

  // 2. Parse blocklist: { plugins: [{ plugin: compositeKey }] }
  const blocklistData = await safeReadJson(paths.blocklist)
  const blockedSet = new Set<string>()
  const blocklistPlugins = blocklistData['plugins']
  if (Array.isArray(blocklistPlugins)) {
    for (const entry of blocklistPlugins) {
      const e = entry as Record<string, unknown>
      if (typeof e['plugin'] === 'string') {
        blockedSet.add(e['plugin'])
      }
    }
  }

  // 3. Parse installed_plugins.json: { version, plugins: Record<compositeKey, InstallInfo[]> }
  const installed = await safeReadJson(paths.installedPlugins)
  const pluginsRecord = installed['plugins']

  if (pluginsRecord && typeof pluginsRecord === 'object' && !Array.isArray(pluginsRecord)) {
    // Primary path: use installed_plugins.json manifest
    return resolveFromManifest(
      pluginsRecord as Record<string, RawInstallInfo[]>,
      enabledMap,
      blockedSet,
    )
  }

  // Fallback: scan plugin cache directory (3-level: marketplace/plugin/version)
  return resolveFromCacheDir(paths.pluginCache, enabledMap, blockedSet)
}

async function resolveFromManifest(
  pluginsRecord: Record<string, RawInstallInfo[]>,
  enabledMap: Record<string, boolean>,
  blockedSet: Set<string>,
): Promise<ResolvedPlugin[]> {
  const results: ResolvedPlugin[] = []

  for (const [compositeKey, installInfos] of Object.entries(pluginsRecord)) {
    if (!Array.isArray(installInfos) || installInfos.length === 0) continue

    const identity = parseCompositeKey(compositeKey)
    // Use the latest install info (last entry)
    const info = installInfos[installInfos.length - 1]
    if (!info.installPath) continue

    const manifest = await loadManifest(info.installPath)

    results.push({
      name: identity.pluginName,
      marketplace: identity.marketplace,
      compositeKey,
      version: info.version ?? '',
      installPath: info.installPath,
      enabled: enabledMap[compositeKey] === true,
      blocked: blockedSet.has(compositeKey),
      installScope: info.scope ?? 'user',
      manifest,
    })
  }

  return results
}

async function resolveFromCacheDir(
  cacheDir: string,
  enabledMap: Record<string, boolean>,
  blockedSet: Set<string>,
): Promise<ResolvedPlugin[]> {
  const results: ResolvedPlugin[] = []
  const marketplaces = await safeDirEntries(cacheDir)

  for (const mkt of marketplaces) {
    if (!mkt.isDir) continue
    const mktDir = path.join(cacheDir, mkt.name)
    const plugins = await safeDirEntries(mktDir)

    for (const plugin of plugins) {
      if (!plugin.isDir) continue
      const pluginDir = path.join(mktDir, plugin.name)
      const versions = await safeDirEntries(pluginDir)

      // Pick latest version (last directory entry)
      const latestVersion = versions.filter(v => v.isDir).pop()
      if (!latestVersion) continue

      const installPath = path.join(pluginDir, latestVersion.name)
      const compositeKey = `${plugin.name}@${mkt.name}`
      const manifest = await loadManifest(installPath)

      results.push({
        name: plugin.name,
        marketplace: mkt.name,
        compositeKey,
        version: latestVersion.name,
        installPath,
        enabled: enabledMap[compositeKey] === true,
        blocked: blockedSet.has(compositeKey),
        installScope: 'user',
        manifest,
      })
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Convention-over-Configuration: capability directory resolution
// ---------------------------------------------------------------------------

/**
 * Resolve capability directories for a plugin.
 *
 * Strategy:
 * 1. If the manifest explicitly declares paths for the category → resolve
 *    them relative to `installPath`
 * 2. Otherwise, fall back to convention paths:
 *    - `{installPath}/{category}/`
 *    - `{installPath}/.claude/{category}/`
 *
 * This encapsulates the Claude Code CLI `WBB` convention-over-configuration
 * pattern so that individual scanners never need to know about it.
 */
export function resolveCapabilityDirs(
  plugin: ResolvedPlugin,
  category: 'skills' | 'commands' | 'agents',
): string[] {
  const manifest = plugin.manifest
  const declaredPaths = manifest?.[category] as string[] | undefined

  if (Array.isArray(declaredPaths) && declaredPaths.length > 0) {
    // Manifest-declared paths (relative to installPath)
    return declaredPaths.map(p => path.resolve(plugin.installPath, p))
  }

  // Convention-over-configuration fallback
  return [
    path.join(plugin.installPath, category),
    path.join(plugin.installPath, '.claude', category),
  ]
}

/**
 * Resolve hooks directory for a plugin.
 *
 * Hooks follow a different convention: `{installPath}/hooks/hooks.json`
 * (there is no manifest-level declaration for hooks).
 */
export function resolveHooksFile(plugin: ResolvedPlugin): string {
  return path.join(plugin.installPath, 'hooks', 'hooks.json')
}
