// SPDX-License-Identifier: Apache-2.0

/**
 * Shared helpers for Capability form logic — used by both
 * CapabilityCreateModal (modal creation) and CapabilityEditView (panel editing).
 */
import type {
  CapabilityEntry,
  ManagedCapabilityCategory,
  CapabilitySaveFormParams,
  CommandFormData,
  AgentFormData,
  SkillFormData,
  RuleFormData,
  HookFormData,
  MCPServerFormData,
  MCPServerTemplate,
  MCPServerOption,
} from '@shared/types'
import type { FormMode } from '@/components/DetailPanel/forms/types'
import { configToHookFormData, configToMCPFormData } from './configAdapters'

// ── entryToFormData ─────────────────────────────────────────────────

/**
 * Extract form-compatible initial data from a CapabilityEntry.
 *
 * Document types: name + description + body + category-specific attributes.
 * Config types: category-aware deserialization via configAdapters — produces
 * the exact field shapes that HookForm / MCPServerForm expect.
 */
export function entryToFormData(entry: CapabilityEntry): Record<string, unknown> {
  if (entry.kind === 'document') {
    return {
      name: entry.name,
      description: entry.description,
      body: entry.body,
      ...entry.attributes,
    }
  }

  // Config type — delegate to category-specific deserializers
  if (entry.category === 'hook') {
    return {
      name: entry.name,
      ...configToHookFormData(entry.config),
    }
  }
  if (entry.category === 'mcp-server') {
    return {
      name: entry.name,
      ...configToMCPFormData(entry.config),
    }
  }

  // Fallback (shouldn't reach here for known categories)
  return {
    name: entry.name,
    ...entry.config,
  }
}

// ── buildFormMode ───────────────────────────────────────────────────

export function buildFormMode<T>(
  mode: 'create' | 'edit',
  entry?: CapabilityEntry,
): FormMode<T> {
  if (mode === 'edit' && entry) {
    return { type: 'edit', initialData: entryToFormData(entry) as T }
  }
  return { type: 'create' }
}

// ── buildSaveParams ─────────────────────────────────────────────────

/**
 * Type-safe construction of CapabilitySaveFormParams.
 * Uses a switch on category to produce the correct discriminated union member.
 */
export function buildSaveParams(
  category: ManagedCapabilityCategory,
  scope: 'global' | 'project',
  name: string,
  projectId: string | undefined,
  data: Record<string, unknown>,
): CapabilitySaveFormParams {
  const base = { scope, name, projectId }
  switch (category) {
    case 'command':
      return { ...base, category, data: data as unknown as CommandFormData }
    case 'agent':
      return { ...base, category, data: data as unknown as AgentFormData }
    case 'skill':
      return { ...base, category, data: data as unknown as SkillFormData }
    case 'rule':
      return { ...base, category, data: data as unknown as RuleFormData }
    case 'hook':
      return { ...base, category, data: data as unknown as HookFormData }
    case 'mcp-server':
      return { ...base, category, data: data as unknown as MCPServerFormData }
  }
}

// ── MCP Template Helpers ──────────────────────────────────────────────

/**
 * Resolve template options into CLI args and merge with the form's existing args.
 *
 * Rules:
 * - boolean + 'when-true': append flag when value is true
 * - boolean + 'when-false': append flag when value is false
 * - string/select: append `--flag=value` when value is non-empty
 * - Deduplication: if the flag already exists in baseArgs, skip (user manual override wins)
 */
export function resolveTemplateOptions(
  baseArgs: string[],
  options: MCPServerOption[],
  values: Record<string, boolean | string>,
): string[] {
  const result = [...baseArgs]
  const existingFlags = new Set(result.map((a) => a.split('=')[0]))

  for (const opt of options) {
    const val = values[opt.id] ?? opt.defaultValue
    const flag = opt.argMapping.flag

    // Skip if user already manually added this flag
    if (existingFlags.has(flag)) continue

    if (opt.type === 'boolean') {
      const boolVal = val as boolean
      const condition = opt.argMapping.condition ?? 'when-true'
      if ((condition === 'when-true' && boolVal) || (condition === 'when-false' && !boolVal)) {
        result.push(flag)
      }
    } else {
      const strVal = (val as string).trim()
      if (strVal) {
        result.push(`${flag}=${strVal}`)
      }
    }
  }

  return result
}

/**
 * Build a FormMode from a template selection.
 * "Custom" sentinel returns plain create mode; real templates return create-from-template.
 */
export function buildTemplateFormMode(
  template: MCPServerTemplate,
  variantId: string | undefined,
): FormMode<MCPServerFormData & { name: string }> {
  if (template.id === '__custom__') {
    return { type: 'create' }
  }

  const variant = template.variants.find((v) => v.id === variantId)
  const config = { ...template.serverConfig, ...(variant?.serverConfig ?? {}) }

  return {
    type: 'create-from-template',
    templateId: template.id,
    initialData: {
      name: template.id,
      type: config.type,
      command: config.command,
      args: config.args ?? [],
      env: config.env ?? {},
      configFile: '.mcp.json' as const,
    },
  }
}
