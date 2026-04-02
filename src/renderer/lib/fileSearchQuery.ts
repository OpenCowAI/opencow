// SPDX-License-Identifier: Apache-2.0

export interface ParsedFileSearchQuery {
  searchText: string
  line: number | null
}

/**
 * Parse optional line suffix from quick-open query.
 * Example: "src/app.ts:128" -> { searchText: "src/app.ts", line: 128 }
 */
export function parseFileSearchQuery(raw: string): ParsedFileSearchQuery {
  const input = raw.trim()
  if (input.length === 0) return { searchText: '', line: null }

  const match = /^(.*?):(\d{1,7})$/.exec(input)
  if (!match) return { searchText: input, line: null }

  const searchText = match[1].trim()
  const line = Number.parseInt(match[2], 10)
  if (!Number.isFinite(line) || line <= 0) {
    return { searchText: input, line: null }
  }

  if (searchText.length === 0) {
    return { searchText: input, line: null }
  }

  return { searchText, line }
}
