// SPDX-License-Identifier: Apache-2.0

/**
 * Serialize Content — converts structured FormData into file content.
 *
 * v3.1 fix #9: complete serialization for all 6 categories.
 *
 * Document-type (skill/agent/command/rule) → YAML frontmatter + body
 * Config-type (hook/mcp-server) → JSON
 */

import { buildFrontmatter } from '@shared/frontmatter'
import type {
  SkillFormData,
  AgentFormData,
  CommandFormData,
  RuleFormData,
  HookFormData,
  HookRuleFormData,
  MCPServerFormData,
  CapabilitySaveFormParams,
} from '@shared/types'

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Serialize form data into file content based on category.
 * Returns a string ready to be written to disk.
 */
export function serializeFormToContent(params: CapabilitySaveFormParams): string {
  switch (params.category) {
    case 'skill':
    case 'rule':
      return serializeSimpleDocument(params.name, params.data)
    case 'agent':
      return serializeAgent(params.name, params.data)
    case 'command':
      return serializeCommand(params.name, params.data)
    case 'hook':
      return serializeHook(params.name, params.data)
    case 'mcp-server':
      return serializeMcpServer(params.name, params.data)
    default: {
      // Exhaustive check: this should never happen
      const _exhaustive: never = params
      throw new Error(`Unknown category: ${(_exhaustive as CapabilitySaveFormParams).category}`)
    }
  }
}

// ─── Document-type Serializers ───────────────────────────────────────────

/** Shared serializer for skill and rule (identical frontmatter structure). */
function serializeSimpleDocument(name: string, data: { description: string; body: string }): string {
  const fm = buildFrontmatter({ name, description: data.description })
  return `${fm}\n${data.body}`
}

function serializeAgent(name: string, data: AgentFormData): string {
  const fields: Record<string, unknown> = {
    name,
    description: data.description,
  }
  if (data.model) fields['model'] = data.model
  if (data.color) fields['color'] = data.color

  const fm = buildFrontmatter(fields)
  return `${fm}\n${data.body}`
}

function serializeCommand(name: string, data: CommandFormData): string {
  const fields: Record<string, unknown> = {
    name,
    description: data.description,
  }
  if (data.argumentHint) fields['argument-hint'] = data.argumentHint

  const fm = buildFrontmatter(fields)
  return `${fm}\n${data.body}`
}

// ─── Config-type Serializers ─────────────────────────────────────────────

function serializeHook(name: string, data: HookFormData): string {
  const events = buildHookEvents(data.rules)
  return JSON.stringify({ name, events }, null, 2)
}

function serializeMcpServer(name: string, data: MCPServerFormData): string {
  const serverConfig: Record<string, unknown> = {
    type: data.type || 'stdio',
    command: data.command,
  }
  if (data.args && data.args.length > 0) serverConfig['args'] = data.args
  if (data.env && Object.keys(data.env).length > 0) serverConfig['env'] = data.env

  return JSON.stringify({ name, serverConfig }, null, 2)
}

// ─── Hook Event Builder ─────────────────────────────────────────────────

/**
 * Group hook rules by event name into the declarative hook format.
 *
 * Input:  [{ type: 'command', command: 'echo hi', event: 'PreToolUse', matcher: 'Bash' }]
 * Output: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] }
 */
function buildHookEvents(
  rules: HookRuleFormData[],
): Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command?: string; prompt?: string }> }>> {
  const events: Record<
    string,
    Array<{ matcher?: string; hooks: Array<{ type: string; command?: string; prompt?: string }> }>
  > = {}

  for (const rule of rules) {
    const eventName = rule.event || 'PostToolUse'
    if (!events[eventName]) events[eventName] = []

    // Find or create a group for this matcher
    const matcher = rule.matcher || undefined
    let group = events[eventName].find((g) => g.matcher === matcher)
    if (!group) {
      group = { matcher, hooks: [] }
      events[eventName].push(group)
    }

    // Build the hook entry
    const hookEntry: { type: string; command?: string; prompt?: string } = {
      type: rule.type,
    }
    if (rule.type === 'command' && rule.command) {
      hookEntry.command = rule.command
    }
    if (rule.type === 'prompt' && rule.command) {
      hookEntry.prompt = rule.command
    }

    group.hooks.push(hookEntry)
  }

  return events
}
