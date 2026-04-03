// SPDX-License-Identifier: Apache-2.0

/**
 * File search algorithm — fuzzy matching, scoring, and highlighting.
 *
 * Pure functions with no side effects. Can be used in both main and renderer processes.
 *
 * @module fileSearch
 */

import type { FileEntry } from './types'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** A single fuzzy match result with score and character-level highlights. */
export interface FuzzyMatchResult {
  /** Overall match score (higher = better) */
  score: number
  /** Indices of matched characters in the source text (for UI highlighting) */
  highlights: number[]
}

/** A scored file search result, ready for rendering. */
export interface FileSearchMatch {
  entry: FileEntry
  /** Composite score (higher = better, 0 = no match) */
  score: number
  /** Matched character indices in `entry.name` */
  nameHighlights: number[]
  /** Matched character indices in `entry.path` */
  pathHighlights: number[]
}

/** Tunable scoring weights for `searchFiles`. */
export interface ScoringWeights {
  /** Bonus for exact name match (case-insensitive) */
  exactName: number
  /** Bonus for name starting with query */
  namePrefix: number
  /** Base multiplier applied to fuzzyMatch score on name */
  nameFuzzyMultiplier: number
  /** Multiplier applied to fuzzyMatch score on path (lower = less weight) */
  pathFuzzyMultiplier: number
  /** Bonus per level of shallowness (root = max bonus) */
  shallowDepthBonus: number
  /** Max depth levels that receive the bonus */
  shallowDepthMaxLevels: number
}

/** Options for `searchFiles`. */
export interface SearchFilesOptions {
  maxResults?: number
  weights?: Partial<ScoringWeights>
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Directories to skip during file indexing and listing. */
export const SKIP_DIRECTORIES = new Set([
  'node_modules', '.git', '.hg', '.svn',
  '.next', '.nuxt', '.output', '.svelte-kit',
  'dist', 'build', 'out', 'target',
  '__pycache__', '.venv', 'venv',
  '.cache', 'coverage', '.turbo', '.vercel',
  '.idea', '.vscode', '.DS_Store',
  '.opencow-trash',
])

/**
 * Whether a file/directory name should be skipped during traversal.
 *
 * Uses an explicit skip list — NOT a blanket `name.startsWith('.')` filter.
 * Dot-files like `.gitignore`, `.env`, `.claude/` are common configuration
 * files that users need to see and edit. Only genuinely noisy entries
 * (VCS internals, build output, OS artifacts) are in SKIP_DIRECTORIES.
 */
export function shouldSkipEntry(name: string): boolean {
  return SKIP_DIRECTORIES.has(name)
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  exactName: 100,
  namePrefix: 70,
  nameFuzzyMultiplier: 1,
  pathFuzzyMultiplier: 0.3,
  shallowDepthBonus: 3,
  shallowDepthMaxLevels: 5,
}

/* ------------------------------------------------------------------ */
/*  Fuzzy Match                                                        */
/* ------------------------------------------------------------------ */

/**
 * Check if a character is a word boundary position.
 * Word boundaries: start of string, after `/`, `-`, `_`, `.`, or a camelCase transition.
 */
function isWordBoundary(text: string, index: number): boolean {
  if (index === 0) return true
  const prev = text.charCodeAt(index - 1)
  const curr = text.charCodeAt(index)
  // After separator: / - _ .
  if (prev === 47 || prev === 45 || prev === 95 || prev === 46) return true
  // camelCase: lowercase → uppercase
  if (prev >= 97 && prev <= 122 && curr >= 65 && curr <= 90) return true
  // CJK character: every character is a word boundary
  if (isCjk(curr) || isCjk(prev)) return true
  return false
}

/** Detect CJK characters (Chinese, Japanese, Korean). */
function isCjk(code: number): boolean {
  return (
    (code >= 0x4E00 && code <= 0x9FFF) ||   // CJK Unified Ideographs
    (code >= 0x3400 && code <= 0x4DBF) ||   // CJK Extension A
    (code >= 0x3040 && code <= 0x309F) ||   // Hiragana
    (code >= 0x30A0 && code <= 0x30FF) ||   // Katakana
    (code >= 0xAC00 && code <= 0xD7AF)      // Korean Hangul
  )
}

/**
 * Compute a fuzzy match of `query` against `text`.
 *
 * Algorithm:
 * 1. All characters in `query` must appear in `text` in order (case-insensitive).
 * 2. Scoring rewards:
 *    - Matching at a word boundary (camelCase, separator)  → +10
 *    - Consecutive matches                                 → +8 per consecutive char
 *    - Matching at position 0 of text                     → +15
 *    - Any other match                                    → +3
 * 3. Uses a greedy-with-fallback strategy: prefer word-boundary matches,
 *    fall back to next available character if none found.
 *
 * @returns Match result with score and highlight indices, or `null` if no match.
 */
export function fuzzyMatch(text: string, query: string): FuzzyMatchResult | null {
  if (!query) return { score: 0, highlights: [] }
  if (!text) return null

  const textLower = text.toLowerCase()
  const queryLower = query.toLowerCase()

  // Quick bail: every query char must exist somewhere in text
  {
    let checkIdx = 0
    for (let q = 0; q < queryLower.length; q++) {
      const found = textLower.indexOf(queryLower[q], checkIdx)
      if (found < 0) return null
      checkIdx = found + 1
    }
  }

  // --- Scoring pass ---
  // Priority: consecutive > word-boundary > fallback.
  // Consecutive matches are always "safe" — they advance textIdx by exactly 1,
  // never skipping characters that may be needed later in the query.
  // Word-boundary matches jump forward and risk exhausting needed characters.
  const highlights: number[] = []
  let score = 0
  let textIdx = 0
  let prevMatchIdx = -2 // -2 so first match is never "consecutive"

  for (let qi = 0; qi < queryLower.length; qi++) {
    const qChar = queryLower[qi]
    let bestIdx = -1
    let bestScore = -1

    // Strategy 1 (highest priority): consecutive match — safe, preserves valid path
    if (prevMatchIdx >= 0 && prevMatchIdx + 1 < textLower.length) {
      const consecutiveIdx = prevMatchIdx + 1
      if (textLower[consecutiveIdx] === qChar) {
        bestIdx = consecutiveIdx
        bestScore = 8 + (consecutiveIdx === 0 ? 15 : 0)
      }
    }

    // Strategy 2: word-boundary match (only when no consecutive match)
    if (bestIdx < 0) {
      for (let t = textIdx; t < Math.min(textIdx + 30, textLower.length); t++) {
        if (textLower[t] === qChar && isWordBoundary(text, t)) {
          bestIdx = t
          bestScore = 10 + (t === 0 ? 15 : 0)
          break // take first boundary match
        }
      }
    }

    // Strategy 3: fallback to next available character
    if (bestIdx < 0 || bestIdx < textIdx) {
      const fallback = textLower.indexOf(qChar, textIdx)
      if (fallback < 0) return null // should not happen (pre-checked)
      bestIdx = fallback
      bestScore = (fallback === 0 ? 15 : 0) + (isWordBoundary(text, fallback) ? 10 : 3)
    }

    // Consecutive bonus (on top of base score)
    if (bestIdx === prevMatchIdx + 1 && qi > 0) {
      score += 8
    }

    highlights.push(bestIdx)
    score += bestScore
    prevMatchIdx = bestIdx
    textIdx = bestIdx + 1
  }

  return { score, highlights }
}

/* ------------------------------------------------------------------ */
/*  Search & Score                                                     */
/* ------------------------------------------------------------------ */

/**
 * Score a single file entry against a query.
 *
 * Combines name fuzzy match (primary), path fuzzy match (secondary),
 * and path depth bonus (shallower files rank higher).
 */
export function scoreFileEntry(
  entry: FileEntry,
  query: string,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): FileSearchMatch | null {
  const queryLower = query.toLowerCase()
  const nameLower = entry.name.toLowerCase()

  const nameMatch = fuzzyMatch(entry.name, query)
  const pathMatch = fuzzyMatch(entry.path, query)

  if (!nameMatch && !pathMatch) return null

  let score = 0

  // 1. Name match scoring
  if (nameMatch && nameMatch.score > 0) {
    if (nameLower === queryLower) {
      score += weights.exactName
    } else if (nameLower.startsWith(queryLower)) {
      score += weights.namePrefix
    } else {
      score += nameMatch.score * weights.nameFuzzyMultiplier
    }
  } else if (nameMatch) {
    // Empty query matched name — small base score
    score += 1
  }

  // 2. Path match scoring (secondary, capped)
  if (pathMatch && pathMatch.score > 0) {
    score += Math.min(pathMatch.score * weights.pathFuzzyMultiplier, 20)
  }

  // 3. Path depth bonus (shallower = higher score)
  const depth = entry.path.split('/').length - 1
  const depthBonus = Math.max(
    0,
    (weights.shallowDepthMaxLevels - depth) * weights.shallowDepthBonus,
  )
  score += depthBonus

  return {
    entry,
    score,
    nameHighlights: nameMatch?.highlights ?? [],
    pathHighlights: pathMatch?.highlights ?? [],
  }
}

/**
 * Search a list of file entries with fuzzy matching, scoring, and sorting.
 *
 * Pure function — takes entries + query, returns sorted scored results.
 */
export function searchFiles(
  entries: readonly FileEntry[],
  query: string,
  options?: SearchFilesOptions,
): FileSearchMatch[] {
  const maxResults = options?.maxResults ?? 30
  const weights = { ...DEFAULT_WEIGHTS, ...options?.weights }

  if (!query) {
    // No query — return entries with minimal score (preserve original order)
    return entries.slice(0, maxResults).map((entry) => ({
      entry,
      score: 0,
      nameHighlights: [],
      pathHighlights: [],
    }))
  }

  const matches: FileSearchMatch[] = []

  for (const entry of entries) {
    const match = scoreFileEntry(entry, query, weights)
    if (match) matches.push(match)
  }

  // Sort by score descending, then by name alphabetically for ties
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.entry.name.localeCompare(b.entry.name)
  })

  return matches.slice(0, maxResults)
}

/* ------------------------------------------------------------------ */
/*  Highlight Rendering Utilities                                      */
/* ------------------------------------------------------------------ */

/** A consecutive run of highlighted or non-highlighted text. */
export interface HighlightRun {
  text: string
  highlighted: boolean
}

/**
 * Convert character-level highlight indices into consecutive text runs.
 *
 * This produces 3-5 DOM nodes per filename instead of one per character.
 *
 * @example
 * buildHighlightRuns("SessionInputBar.tsx", [0, 7, 12])
 * // → [{ text: "S", hl: true }, { text: "ession", hl: false }, { text: "I", hl: true }, ...]
 */
export function buildHighlightRuns(text: string, highlights: number[]): HighlightRun[] {
  if (highlights.length === 0) return [{ text, highlighted: false }]

  const set = new Set(highlights)
  const runs: HighlightRun[] = []
  let i = 0

  while (i < text.length) {
    const isHl = set.has(i)
    let j = i + 1
    while (j < text.length && set.has(j) === isHl) j++
    runs.push({ text: text.slice(i, j), highlighted: isHl })
    i = j
  }

  return runs
}
