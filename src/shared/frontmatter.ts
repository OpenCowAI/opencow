// SPDX-License-Identifier: Apache-2.0

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

export interface ParsedFrontmatter {
  /** Structured attributes (full YAML object, supports nesting) */
  attributes: Record<string, unknown>
  /** Body content after the frontmatter block */
  body: string
}

const FENCE = /^---\s*$/

/**
 * Parse YAML frontmatter from markdown content.
 *
 * Supports full YAML syntax including nested objects, arrays, etc.
 * Gracefully falls back to empty attributes if YAML parsing fails.
 */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const lines = raw.split(/\r?\n/)

  if (!FENCE.test(lines[0] ?? '')) {
    return { attributes: {}, body: raw }
  }

  const closeIdx = lines.findIndex((l, i) => i > 0 && FENCE.test(l))
  if (closeIdx < 0) {
    return { attributes: {}, body: raw }
  }

  const yamlBlock = lines.slice(1, closeIdx).join('\n')
  const body = lines.slice(closeIdx + 1).join('\n').trimStart()

  try {
    const parsed = parseYaml(yamlBlock)
    return {
      attributes: parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {},
      body,
    }
  } catch {
    return { attributes: {}, body: raw }
  }
}

/** Extract the body content after the frontmatter block (backward-compat API) */
export function extractBody(content: string): string {
  return parseFrontmatter(content).body
}

/**
 * Build a YAML frontmatter block from a key-value record.
 *
 * Supports nested objects/arrays via `yaml` stringify.
 * Empty/null/undefined values are omitted.
 */
export function buildFrontmatter(fields: Record<string, unknown>): string {
  const cleaned = Object.fromEntries(
    Object.entries(fields).filter(
      ([, v]) => v !== undefined && v !== null && v !== '',
    ),
  )
  if (Object.keys(cleaned).length === 0) return '---\n---'
  const yaml = stringifyYaml(cleaned, { lineWidth: 0 }).trimEnd()
  return `---\n${yaml}\n---`
}
