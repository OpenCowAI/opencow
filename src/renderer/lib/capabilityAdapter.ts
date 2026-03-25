// SPDX-License-Identifier: Apache-2.0

/**
 * Adapter layer: CapabilityEntry → UI Entry types
 *
 * Bridges the Capability Center data model to the UI component contract.
 *
 * Document-type capabilities (skill/command/agent/rule) map directly to
 * CapabilityEntryBase since they only need name/description/source.
 *
 * Config-type capabilities (hook/mcp-server) require category-specific mapping
 * via configAdapters to produce HookEventConfig / MCPServerEntry with their
 * structured fields (ruleGroups, serverType, etc.).
 */
import type {
  CapabilityEntry,
  DocumentCapabilityEntry,
  ConfigCapabilityEntry,
  CapabilitySnapshot,
  CapabilityEntryBase,
  CapabilitySource,
  ManagedCapabilityIdentifier,
  ManagedCapabilityCategory,
} from '@shared/types'
import type { SlashItem } from '@shared/slashItems'
import { configToHookEntry, configToMCPEntry } from './configAdapters'

// ── Constants ────────────────────────────────────────────────────────

/** The 6 managed capability categories — compile-time safe with ManagedCapabilityCategory */
const MANAGED_CATEGORIES: ReadonlySet<ManagedCapabilityCategory> = new Set<ManagedCapabilityCategory>([
  'skill',
  'agent',
  'command',
  'rule',
  'hook',
  'mcp-server',
])

/** Snapshot plural keys → singular category IDs (typed tuple for safety) */
const SNAPSHOT_KEY_TO_CATEGORY: ReadonlyArray<
  [keyof CapabilitySnapshot & string, ManagedCapabilityCategory]
> = [
  ['skills', 'skill'],
  ['agents', 'agent'],
  ['commands', 'command'],
  ['rules', 'rule'],
  ['hooks', 'hook'],
  ['mcpServers', 'mcp-server'],
]

// ── Type Guard ───────────────────────────────────────────────────────

/** Type guard: is this category managed by Capability Center? */
export function isManagedCategory(category: string): category is ManagedCapabilityCategory {
  return MANAGED_CATEGORIES.has(category as ManagedCapabilityCategory)
}

// ── Entry Adapter ────────────────────────────────────────────────────

/**
 * Project a CapabilityEntry into a CapabilityEntryBase-compatible shape.
 *
 * For document-type entries (skill/command/agent/rule): produces base fields only.
 * For config-type entries (hook/mcp-server): delegates to config adapters for
 * category-specific field extraction.
 */
export function toCapabilityEntry(entry: CapabilityEntry): CapabilityEntryBase {
  const source = buildSource(entry)

  // Config-type entries need category-specific mapping to populate structured fields
  if (entry.kind === 'config') {
    const configEntry = entry as ConfigCapabilityEntry
    if (entry.category === 'hook') return configToHookEntry(configEntry, source)
    if (entry.category === 'mcp-server') return configToMCPEntry(configEntry, source)
  }

  // Document-type entries: base fields are sufficient
  return {
    name: entry.name,
    description: entry.description,
    source,
  }
}

// ── Identifier Builder ───────────────────────────────────────────────

/** Build a ManagedCapabilityIdentifier from a CapabilityEntry */
export function toCapabilityId(entry: CapabilityEntry): ManagedCapabilityIdentifier {
  return {
    category: entry.category,
    name: entry.name,
    scope: entry.scope,
    filePath: entry.filePath,
    projectId: entry.projectId,
  }
}

// ── Snapshot Utilities ───────────────────────────────────────────────

/**
 * Options for {@link flattenSnapshot}.
 */
export interface FlattenSnapshotOptions {
  /**
   * Exclude entries projected by an external provider (e.g. Evose Settings).
   *
   * Projected entries remain in the snapshot for session injection but should
   * not appear in the Capabilities management UI — their lifecycle is managed
   * by the provider's own Settings page, not by the Capabilities editor.
   *
   * An entry is considered "projected" when `metadata.projected === true`.
   */
  excludeProjected?: boolean
}

/**
 * Flatten a CapabilitySnapshot into per-category arrays of UI-compatible entries.
 *
 * Each entry is mapped through toCapabilityEntry() which performs category-aware
 * conversion — config types produce their full typed shape (HookEventConfig,
 * MCPServerEntry) rather than being stripped to CapabilityEntryBase.
 */
export function flattenSnapshot(
  snapshot: CapabilitySnapshot,
  options?: FlattenSnapshotOptions,
): Record<ManagedCapabilityCategory, CapabilityEntryBase[]> {
  const result = {} as Record<ManagedCapabilityCategory, CapabilityEntryBase[]>

  for (const [snapshotKey, category] of SNAPSHOT_KEY_TO_CATEGORY) {
    const entries = snapshot[snapshotKey]
    if (Array.isArray(entries)) {
      let filtered = entries as CapabilityEntry[]
      if (options?.excludeProjected) {
        filtered = filtered.filter((e) => e.metadata?.['projected'] !== true)
      }
      result[category] = filtered.map(toCapabilityEntry)
    } else {
      result[category] = []
    }
  }

  return result
}

/**
 * Build a Map from `"category:scope:name"` → CapabilityEntry for O(1) lookup.
 *
 * Use this in components that own the snapshot to resolve full CapabilityEntry
 * data without hidden properties or redundant scanning.
 */
export function buildCapabilityMap(
  snapshot: CapabilitySnapshot,
): Map<string, CapabilityEntry> {
  const map = new Map<string, CapabilityEntry>()
  for (const [snapshotKey, category] of SNAPSHOT_KEY_TO_CATEGORY) {
    const entries = snapshot[snapshotKey]
    if (Array.isArray(entries)) {
      for (const entry of entries as CapabilityEntry[]) {
        map.set(capabilityKey(category, entry.scope, entry.name), entry)
      }
    }
  }
  return map
}

/**
 * Resolve a single CapabilityEntry from the snapshot by identifier fields.
 */
export function resolveCapability(
  snapshot: CapabilitySnapshot,
  category: ManagedCapabilityCategory,
  name: string,
  scope?: string,
): CapabilityEntry | undefined {
  const pair = SNAPSHOT_KEY_TO_CATEGORY.find(([, cat]) => cat === category)
  if (!pair) return undefined

  const entries = snapshot[pair[0]]
  if (!Array.isArray(entries)) return undefined

  return (entries as CapabilityEntry[]).find(
    (e) => e.name === name && (scope === undefined || e.scope === scope),
  )
}

/** Stable composite key for capability lookup: `"category:scope:name"` */
export function capabilityKey(category: string, scope: string, name: string): string {
  return `${category}:${scope}:${name}`
}

// ── Slash Item Adapter ──────────────────────────────────────────────

/**
 * Convert a DocumentCapabilityEntry into a SlashItem for the slash command menu.
 *
 * @param entry    - The capability entry (skill or command)
 * @param category - Explicit category ('command' | 'skill')
 * @param index    - Positional index within its category (used for sort order)
 */
export function capabilityToSlashItem(
  entry: DocumentCapabilityEntry,
  category: 'command' | 'skill',
  index: number,
): SlashItem {
  const evoseMeta = category === 'skill' ? resolveEvoseSlashMetadata(entry.metadata) : null

  return {
    id: `${category}:${entry.scope}:${entry.name}`,
    name: entry.name,
    description: entry.description,
    argumentHint: (entry.attributes['argument-hint'] as string) || undefined,
    category,
    order: index + 1,
    scope: entry.scope,
    origin: deriveOrigin(entry),
    sourcePath: entry.filePath,
    presentation: evoseMeta
      ? {
          variant: 'app',
          title: evoseMeta.displayName,
          subtitle: entry.description,
          avatarUrl: evoseMeta.avatar,
        }
      : undefined,
    executionMeta: evoseMeta
      ? {
          provider: 'evose',
          app: {
            id: evoseMeta.appId,
            type: evoseMeta.appType,
            gatewayTool: evoseMeta.gatewayTool,
          },
        }
      : undefined,
  }
}

/**
 * Filter capability entries to only those that are enabled and eligible.
 */
export function filterActiveEntries<T extends CapabilityEntry>(entries: T[]): T[] {
  return entries.filter((e) => e.enabled && e.eligibility.eligible)
}

/** Priority weight: project scope before global */
const PRIORITY_SCOPE_WEIGHT: Record<string, number> = { project: 0, global: 1 }

/** Priority weight: user-authored before imported */
const PRIORITY_ORIGIN_WEIGHT: Record<string, number> = { project: 0, user: 1, marketplace: 2, plugin: 3 }

/**
 * Sort capability entries by priority: project scope first, then within each
 * scope by origin (user > marketplace > plugin).
 */
export function sortByPriority<T extends CapabilityEntry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const scopeDiff = (PRIORITY_SCOPE_WEIGHT[a.scope] ?? 2) - (PRIORITY_SCOPE_WEIGHT[b.scope] ?? 2)
    if (scopeDiff !== 0) return scopeDiff
    const originA = PRIORITY_ORIGIN_WEIGHT[deriveOrigin(a)] ?? 9
    const originB = PRIORITY_ORIGIN_WEIGHT[deriveOrigin(b)] ?? 9
    return originA - originB
  })
}

// ── Internal Helpers ─────────────────────────────────────────────────

function buildSource(entry: CapabilityEntry): CapabilitySource {
  return {
    scope: entry.scope,
    origin: deriveOrigin(entry),
    sourcePath: entry.filePath,
    // Populate mount provenance from virtual mount info
    mount: entry.mountInfo
      ? { name: entry.mountInfo.namespace, marketplace: entry.mountInfo.marketplace, version: entry.mountInfo.version }
      : undefined,
  }
}

/** Derive CapabilityOrigin from a CapabilityEntry's import metadata and scope. */
export function deriveOrigin(entry: CapabilityEntry): CapabilitySource['origin'] {
  const sourceOrigin = entry.importInfo?.sourceOrigin ?? entry.mountInfo?.sourceOrigin
  if (sourceOrigin === 'plugin') return 'plugin'
  if (sourceOrigin === 'marketplace') return 'marketplace'
  if (entry.scope === 'project') return 'project'
  return 'user'
}

interface EvoseSlashMetadata {
  appId: string
  appType: 'agent' | 'workflow'
  displayName: string
  avatar?: string
  gatewayTool: 'evose_run_agent' | 'evose_run_workflow'
}

function resolveEvoseSlashMetadata(metadata: Record<string, unknown>): EvoseSlashMetadata | null {
  if (metadata['provider'] !== 'evose') return null

  const appId = typeof metadata['appId'] === 'string' ? metadata['appId'].trim() : ''
  const appType = metadata['appType']
  const displayName = typeof metadata['displayName'] === 'string' ? metadata['displayName'].trim() : ''
  const avatar = typeof metadata['avatar'] === 'string' ? metadata['avatar'].trim() : undefined
  const gatewayTool = metadata['gatewayTool']

  if (!appId) return null
  if (appType !== 'agent' && appType !== 'workflow') return null
  if (!displayName) return null
  if (gatewayTool !== 'evose_run_agent' && gatewayTool !== 'evose_run_workflow') return null

  return {
    appId,
    appType,
    displayName,
    avatar: avatar || undefined,
    gatewayTool,
  }
}
