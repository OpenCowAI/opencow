// SPDX-License-Identifier: Apache-2.0

import { parseFrontmatter } from './frontmatter'
import { HOOK_MARKER_KEY } from './appIdentity'
import type { CapabilityCategory } from './types'

/**
 * Resolve the named section from file content, handling nested config structures.
 *
 * Config-based categories store multiple capabilities in a single JSON file:
 * - hook: `settings.json` → `{ "hooks": { [eventName]: [...] } }`
 * - mcp-server: `.claude.json` → `{ "mcpServers": { [name]: {...} } }`
 *               `.mcp.json` → `{ "mcpServers"?: { [name]: {...} } } | { [name]: {...} }`
 *
 * For file-per-capability categories, returns undefined (caller uses full content).
 *
 * Pure function — no side effects, no I/O, fully testable.
 */
export function resolveConfigSection(
  content: string,
  category: CapabilityCategory,
  name: string
): unknown | undefined {
  if (category !== 'hook' && category !== 'mcp-server') return undefined

  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    switch (category) {
      case 'hook': {
        // settings.json nests hooks under "hooks" key
        const hooks = parsed['hooks'] as Record<string, unknown> | undefined
        return hooks?.[name] ?? parsed[name]
      }
      case 'mcp-server': {
        // .claude.json nests under "mcpServers"; .mcp.json may be flat or wrapped
        const servers = parsed['mcpServers'] as Record<string, unknown> | undefined
        return servers?.[name] ?? parsed[name]
      }
    }
  } catch {
    return undefined
  }
}

/**
 * Extract the relevant source section for detail view display.
 *
 * - File-per-capability (command, skill, agent, rule): returns full content as-is.
 * - Config-based (hook, mcp-server): extracts named section as formatted JSON,
 *   preserving structural context so users can map it to the original file.
 *
 * Pure function — no side effects, no I/O, fully testable.
 */
export function extractSourceSection(
  category: CapabilityCategory,
  content: string,
  name: string
): string {
  if (category !== 'hook' && category !== 'mcp-server') return content

  const section = resolveConfigSection(content, category, name)
  if (section === undefined) return content

  switch (category) {
    case 'hook':
      // Preserve structural context: { "hooks": { "EventName": [...] } }
      return JSON.stringify({ hooks: { [name]: section } }, null, 2)
    case 'mcp-server':
      return JSON.stringify({ [name]: section }, null, 2)
    default:
      return content
  }
}

/**
 * Parse raw source file content into form-friendly data.
 * Pure function — no side effects, no I/O, fully testable.
 */
export function parseSourceForForm(
  category: CapabilityCategory,
  content: string,
  name: string
): Record<string, unknown> {
  switch (category) {
    case 'command': {
      const { attributes: fm, body } = parseFrontmatter(content)
      return {
        name,
        description: (fm['description'] as string) ?? '',
        argumentHint: (fm['argument-hint'] as string) ?? '',
        body,
      }
    }
    case 'agent': {
      const { attributes: fm, body } = parseFrontmatter(content)
      return {
        name,
        description: (fm['description'] as string) ?? '',
        model: (fm['model'] as string) ?? '',
        color: (fm['color'] as string) ?? '',
        body,
      }
    }
    case 'skill': {
      const { attributes: fm } = parseFrontmatter(content)
      return { name, description: (fm['description'] as string) ?? '', body: content }
    }
    case 'hook': {
      const section = resolveConfigSection(content, 'hook', name)
      const groups = Array.isArray(section) ? section : []
      const rules = groups
        .filter((g: Record<string, unknown>) => !g[HOOK_MARKER_KEY])
        .flatMap((g: Record<string, unknown>) =>
          (Array.isArray(g['hooks']) ? g['hooks'] : []).map((h: Record<string, unknown>) => ({
            type: (h['type'] as string) ?? 'command',
            command: (h['command'] as string) ?? ''
          }))
        )
      return { eventName: name, rules }
    }
    case 'mcp-server': {
      const section = resolveConfigSection(content, 'mcp-server', name)
      const cfg = (section ?? {}) as Record<string, unknown>
      return {
        name,
        type: (cfg['type'] as string) ?? 'stdio',
        command: (cfg['command'] as string) ?? '',
        args: (cfg['args'] as string[]) ?? [],
        env: (cfg['env'] as Record<string, string>) ?? {},
        configFile: '.mcp.json'
      }
    }
    case 'rule':
    case 'plugin':
    case 'lsp-server': {
      return { name, description: '', body: content }
    }
  }
}
