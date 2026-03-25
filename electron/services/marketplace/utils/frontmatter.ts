// SPDX-License-Identifier: Apache-2.0

/**
 * YAML frontmatter parser for SKILL.md files.
 *
 * Lightweight regex-based parser — avoids pulling in a full yaml dependency.
 * Handles:
 *   - Simple `key: value` pairs
 *   - Quoted strings: `key: 'value'` / `key: "value"`
 *   - Block scalars: `key: >` or `key: |` with indented continuation lines
 */

export interface FrontmatterResult {
  name: string
  description: string
  attributes: Record<string, unknown>
  body: string
}

/** Parse a YAML frontmatter block from raw SKILL.md content. */
export function parseFrontmatter(content: string): FrontmatterResult {
  // Match frontmatter delimiters — body may be empty (just `---\n...\n---\n`)
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/)
  if (!match) {
    return { name: '', description: '', attributes: {}, body: content }
  }

  const yamlBlock = match[1]
  const body = match[2] ?? ''
  const lines = yamlBlock.split('\n')
  const attributes: Record<string, unknown> = {}
  let name = ''
  let description = ''

  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^(\w[\w-]*):\s*(.*)$/)
    if (!kv) continue

    const [, key, rawValue] = kv
    const value = parseYamlValue(rawValue.trim(), lines, i)

    if (key === 'name') name = value
    else if (key === 'description') description = value
    else attributes[key] = value
  }

  return { name, description, attributes, body }
}

/**
 * Parse a single YAML scalar value, handling:
 *   - Quoted strings: `'text'` or `"text"` → strip quotes
 *   - Block scalars: `>` or `|` → collect indented continuation lines
 *   - Plain unquoted: `text here` → as-is
 */
function parseYamlValue(value: string, lines: string[], lineIndex: number): string {
  // Quoted string — strip surrounding quotes
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1)
  }

  // Block scalar (> folded, | literal) — collect indented continuation lines
  if (value === '>' || value === '|') {
    const parts: string[] = []
    for (let j = lineIndex + 1; j < lines.length; j++) {
      if (/^\s+/.test(lines[j])) {
        parts.push(lines[j].trim())
      } else {
        break
      }
    }
    return parts.join(value === '>' ? ' ' : '\n')
  }

  // Plain unquoted value
  return value
}
