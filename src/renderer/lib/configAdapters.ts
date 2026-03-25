// SPDX-License-Identifier: Apache-2.0

/**
 * Config Adapters — bidirectional mapping for config-type capabilities (hook / mcp-server).
 *
 * Problem solved:
 *   Config-type capabilities store data as opaque `Record<string, unknown>` JSON blobs.
 *   The UI layer needs typed entry objects (HookEventConfig, MCPServerEntry) and
 *   structured form data (HookFormData, MCPServerFormData). Without this adapter layer,
 *   there is a "serialization asymmetry": FormData → JSON works, but JSON → UI types was missing.
 *
 * Canonical storage formats (normalized on write):
 *
 *   Hook:       { name, events: { [eventName]: [{ matcher?, hooks: [{ type, command? }] }] } }
 *   MCP Server: { name, serverConfig: { type, command, args?, env? } }
 *
 * This module provides:
 *   1. configToHookEntry()     — ConfigCapabilityEntry → HookEventConfig (for list/card rendering)
 *   2. configToMCPEntry()      — ConfigCapabilityEntry → MCPServerEntry  (for list/card rendering)
 *   3. configToHookFormData()  — config JSON → HookFormData            (for edit form prefill)
 *   4. configToMCPFormData()   — config JSON → MCPServerFormData       (for edit form prefill)
 */
import type {
  ConfigCapabilityEntry,
  HookEventConfig,
  HookRuleGroup,
  HookFormData,
  HookRuleFormData,
  MCPServerEntry,
  MCPServerFormData,
  CapabilitySource,
} from '@shared/types'
import { isPlainObject } from '@shared/typeGuards'

// ── Hook: Shared Parsing ──────────────────────────────────────────────

/** Intermediate representation — a single flattened hook rule with context. */
interface ParsedHookRule {
  type: string
  command?: string
  prompt?: string
  async?: boolean
  eventName: string
  matcher?: string
}

/**
 * Parse hook config JSON into a flat list of rules with context.
 *
 * Single parsing function that handles both storage formats:
 *   - Canonical: `{ events: { EventName: [{ matcher?, hooks: [...] }] } }`
 *   - Legacy:    `{ eventName, rules: [{ type, command }] }`
 *
 * All downstream consumers (card rendering, form prefill) operate on this
 * unified intermediate, eliminating format-detection duplication.
 */
function parseHookRules(config: Record<string, unknown>): ParsedHookRule[] {
  const rules: ParsedHookRule[] = []

  // Canonical format: { events: { EventName: [{ matcher?, hooks: [...] }] } }
  const events = config['events']
  if (isPlainObject(events)) {
    for (const [eventName, ruleGroupList] of Object.entries(events as Record<string, unknown[]>)) {
      if (!Array.isArray(ruleGroupList)) continue
      for (const rg of ruleGroupList) {
        const group = rg as Record<string, unknown>
        const matcher = typeof group['matcher'] === 'string' ? group['matcher'] : undefined
        const hooks = Array.isArray(group['hooks']) ? group['hooks'] : []
        for (const h of hooks) {
          const hook = h as Record<string, unknown>
          rules.push({
            type: (hook['type'] as string) ?? 'command',
            command: typeof hook['command'] === 'string' ? hook['command'] : undefined,
            prompt: typeof hook['prompt'] === 'string' ? hook['prompt'] : undefined,
            async: typeof hook['async'] === 'boolean' ? hook['async'] : undefined,
            eventName,
            matcher,
          })
        }
      }
    }
    return rules
  }

  // Legacy import format: { eventName, rules: [{ type, command }] }
  const legacyEventName = (config['eventName'] as string) ?? ''
  const legacyRules = config['rules']
  if (Array.isArray(legacyRules)) {
    for (const r of legacyRules) {
      const rule = r as Record<string, unknown>
      rules.push({
        type: (rule['type'] as string) ?? 'command',
        command: typeof rule['command'] === 'string' ? rule['command'] : undefined,
        prompt: typeof rule['prompt'] === 'string' ? rule['prompt'] : undefined,
        eventName: legacyEventName,
      })
    }
  }

  return rules
}

// ── Hook: Store → UI Entry ────────────────────────────────────────────

/**
 * Map a ConfigCapabilityEntry (hook) to a HookEventConfig for card rendering.
 */
export function configToHookEntry(
  entry: ConfigCapabilityEntry,
  source: CapabilitySource,
): HookEventConfig {
  const rules = parseHookRules(entry.config)

  // Group rules by matcher into HookRuleGroup[] (the shape HookRow expects)
  const groupMap = new Map<string | undefined, ParsedHookRule[]>()
  for (const rule of rules) {
    const key = rule.matcher
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key)!.push(rule)
  }

  const ruleGroups: HookRuleGroup[] = [...groupMap.entries()].map(([matcher, groupRules]) => ({
    matcher,
    hooks: groupRules.map((r) => ({
      type: r.type as 'command' | 'prompt' | 'agent',
      command: r.command,
      prompt: r.prompt,
      async: r.async,
    })),
    isManagedByApp: false,
  }))

  return {
    name: entry.name,
    description: entry.description,
    source,
    ruleGroups,
  }
}

// ── Hook: Store → Form Data ───────────────────────────────────────────

/**
 * Map stored hook config to HookFormData for edit form prefill.
 */
export function configToHookFormData(config: Record<string, unknown>): HookFormData {
  const parsed = parseHookRules(config)

  if (parsed.length === 0) {
    return { rules: [{ type: 'command', command: '' }] }
  }

  const rules: HookRuleFormData[] = parsed.map((r) => ({
    type: r.type,
    command: r.command ?? r.prompt ?? '',
    event: r.eventName || undefined,
    matcher: r.matcher,
  }))

  return { rules }
}

// ── MCP Server: Shared Parsing ────────────────────────────────────────

/** Resolved MCP server fields from either canonical or legacy format. */
interface ResolvedMCPConfig {
  type: string
  command: string
  args: string[]
  env: Record<string, string>
}

/**
 * Resolve MCP server config from either canonical or legacy format.
 *
 *   - Canonical: `{ serverConfig: { type, command, ... } }`
 *   - Legacy:    `{ type, command, args?, env?, configFile? }` (flat fields)
 */
function resolveMCPConfig(config: Record<string, unknown>): ResolvedMCPConfig {
  // Canonical: { serverConfig: { type, command, ... } }
  const sc = config['serverConfig']
  if (isPlainObject(sc)) {
    return {
      type: (sc['type'] as string) ?? 'stdio',
      command: (sc['command'] as string) ?? '',
      args: Array.isArray(sc['args']) ? (sc['args'] as string[]) : [],
      env: isPlainObject(sc['env'])
        ? (sc['env'] as Record<string, string>)
        : {},
    }
  }

  // Legacy (import): flat fields at top level
  return {
    type: (config['type'] as string) ?? 'stdio',
    command: (config['command'] as string) ?? '',
    args: Array.isArray(config['args']) ? (config['args'] as string[]) : [],
    env: isPlainObject(config['env'])
      ? (config['env'] as Record<string, string>)
      : {},
  }
}

// ── MCP Server: Store → UI Entry ──────────────────────────────────────

/**
 * Map a ConfigCapabilityEntry (mcp-server) to an MCPServerEntry for card rendering.
 */
export function configToMCPEntry(
  entry: ConfigCapabilityEntry,
  source: CapabilitySource,
): MCPServerEntry {
  const resolved = resolveMCPConfig(entry.config)
  return {
    name: entry.name,
    description: entry.description,
    source,
    serverType: resolved.type,
    author: '',
  }
}

// ── MCP Server: Store → Form Data ─────────────────────────────────────

/**
 * Map stored MCP server config to MCPServerFormData for edit form prefill.
 */
export function configToMCPFormData(config: Record<string, unknown>): MCPServerFormData {
  const resolved = resolveMCPConfig(config)
  return {
    type: resolved.type,
    command: resolved.command,
    args: resolved.args,
    env: resolved.env,
    configFile: (config['configFile'] as '.mcp.json' | '.claude.json') ?? '.claude.json',
  }
}

// isPlainObject is imported from @shared/typeGuards — single source of truth.
