// SPDX-License-Identifier: Apache-2.0

/**
 * SDK Command adapter — converts OpenCow's `DocumentCapabilityEntry` (the
 * CapabilityCenter data model for marketplace/project/global skills) into the
 * SDK's internal `Command & { type: 'prompt' }` shape so the SDK's built-in
 * SkillTool can catalog, delta-emit, and dispatch them.
 *
 * ## Why this adapter exists
 *
 * OpenCow's CapabilityCenter has its own skill scanning, caching, eligibility,
 * and distribution pipeline that the SDK's filesystem-based
 * `getModelInvocableCommands()` doesn't cover (marketplace packages, mount
 * providers, project-scoped distribution, etc.). Rather than duplicating the
 * SDK's SkillTool/catalog/activation infrastructure, this adapter bridges
 * the two: OpenCow scans → adapter converts → SDK catalogs & dispatches.
 *
 * ## What the model sees
 *
 * After conversion, each skill appears in the SkillTool's catalog
 * (`formatCommandsWithinBudget`, 1% context budget) and can be invoked via
 * `Skill('name')`. Inline mode injects the skill's markdown body as
 * `newMessages` into the conversation; forked mode runs a sub-agent query.
 *
 * ## Phase 1B.11d
 */

import type { DocumentCapabilityEntry } from '@shared/types'

/**
 * Minimal shape of the SDK's `PromptCommand` that SkillTool can consume.
 *
 * We intentionally do NOT import `Command` from the SDK to avoid pulling
 * CLI-internal types (ToolUseContext, CanUseToolFn, React, etc.) into the
 * Electron main process. Instead we construct a structurally-compatible
 * object that the SDK runtime accepts via `options.commands: unknown[]`.
 *
 * The SDK's `sdkRuntime.ts` casts `options.commands` to `Command[]` internally,
 * and SkillTool's `findCommand()` / `processPromptSlashCommand()` only read
 * the fields listed here.
 */
interface SdkPromptCommandShape {
  type: 'prompt'
  name: string
  description: string
  whenToUse?: string
  progressMessage: string
  contentLength: number
  source: string
  context?: 'inline' | 'fork'
  allowedTools?: string[]
  model?: string
  effort?: string
  disableModelInvocation?: boolean
  userInvocable?: boolean
  loadedFrom?: string
  getPromptForCommand: (args: string) => Promise<Array<{ type: 'text'; text: string }>>
}

/**
 * Convert an OpenCow `DocumentCapabilityEntry` (category: 'skill') into an
 * SDK-compatible `PromptCommand` shape.
 *
 * The returned object is structurally assignable to the SDK's internal
 * `Command & { type: 'prompt' }` type. It is passed via `Options.commands`
 * to the SDK runtime, which merges it into the SkillTool's command pool.
 */
export function toSdkCommand(entry: DocumentCapabilityEntry): SdkPromptCommandShape {
  const metadata = entry.metadata ?? {}

  return {
    type: 'prompt',
    name: entry.name,
    description: entry.description || `Skill: ${entry.name}`,
    whenToUse: asOptionalString(metadata['whenToUse']) ?? asOptionalString(entry.attributes['whenToUse']),
    progressMessage: `Running skill ${entry.name}...`,
    contentLength: entry.body.length,
    source: mapSource(entry),
    context: resolveContext(metadata),
    allowedTools: asOptionalStringArray(metadata['allowedTools']),
    model: asOptionalString(metadata['model']),
    effort: asOptionalString(metadata['effort']),
    disableModelInvocation: metadata['disableModelInvocation'] === true,
    userInvocable: metadata['userInvocable'] !== false,
    loadedFrom: 'skills',

    // The core: return the skill body as a text content block.
    // SkillTool's processPromptSlashCommand calls this to get the content
    // that gets injected into the conversation as UserMessage(s).
    getPromptForCommand: async (_args: string) => [
      { type: 'text' as const, text: entry.body },
    ],
  }
}

/**
 * Map OpenCow's scope/metadata to an SDK source string.
 *
 * The SDK's SkillTool uses `source` for:
 * - telemetry (sanitizing non-builtin/bundled names)
 * - catalog priority (bundled skills get full descriptions when budget is tight)
 * - auto-allow logic (safe-properties check)
 */
function mapSource(entry: DocumentCapabilityEntry): string {
  const provider = entry.metadata?.['provider']
  if (provider === 'evose') return 'plugin'
  if (provider === 'native') return 'plugin'
  if (entry.scope === 'project') return 'projectSettings'
  return 'userSettings'
}

function resolveContext(metadata: Record<string, unknown>): 'inline' | 'fork' | undefined {
  const value = metadata['context']
  if (value === 'fork') return 'fork'
  if (value === 'inline') return 'inline'
  return undefined
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((v): v is string => typeof v === 'string')
  return strings.length > 0 ? strings : undefined
}
