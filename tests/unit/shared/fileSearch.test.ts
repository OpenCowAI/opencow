// SPDX-License-Identifier: Apache-2.0

// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  fuzzyMatch,
  searchFiles,
  scoreFileEntry,
  buildHighlightRuns,
  shouldSkipEntry,
  SKIP_DIRECTORIES,
} from '../../../src/shared/fileSearch'
import type { FileEntry } from '../../../src/shared/types'

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeEntry(name: string, path?: string, isDirectory = false): FileEntry {
  return {
    name,
    path: path ?? name,
    isDirectory,
    size: 0,
    modifiedAt: 0,
  }
}

/* ------------------------------------------------------------------ */
/*  fuzzyMatch                                                         */
/* ------------------------------------------------------------------ */

describe('fuzzyMatch', () => {
  it('returns null for non-matching strings', () => {
    expect(fuzzyMatch('hello', 'xyz')).toBeNull()
    expect(fuzzyMatch('abc', 'abdc')).toBeNull()
  })

  it('returns a result with score 0 for empty query', () => {
    const result = fuzzyMatch('anything', '')
    expect(result).not.toBeNull()
    expect(result!.score).toBe(0)
    expect(result!.highlights).toEqual([])
  })

  it('returns null for empty text with non-empty query', () => {
    expect(fuzzyMatch('', 'a')).toBeNull()
  })

  it('matches exact string with high score', () => {
    const result = fuzzyMatch('App.tsx', 'App.tsx')
    expect(result).not.toBeNull()
    expect(result!.score).toBeGreaterThan(50)
    expect(result!.highlights).toHaveLength(7)
  })

  it('matches prefix with good score', () => {
    const result = fuzzyMatch('SessionInputBar.tsx', 'Session')
    expect(result).not.toBeNull()
    expect(result!.score).toBeGreaterThan(40)
    // All 7 chars should be consecutive from index 0
    expect(result!.highlights[0]).toBe(0)
    expect(result!.highlights).toHaveLength(7)
  })

  it('matches camelCase boundaries (sib → SessionInputBar)', () => {
    const result = fuzzyMatch('SessionInputBar.tsx', 'sib')
    expect(result).not.toBeNull()
    expect(result!.highlights).toHaveLength(3)
    // S at 0, I at 7, B at 12
    expect(result!.highlights).toContain(0)
    expect(result!.highlights).toContain(7)
    expect(result!.highlights).toContain(12)
  })

  it('matches camelCase boundaries (fml → FileMentionList)', () => {
    const result = fuzzyMatch('FileMentionList.tsx', 'fml')
    expect(result).not.toBeNull()
    expect(result!.highlights).toHaveLength(3)
    expect(result!.highlights).toContain(0)  // F
    expect(result!.highlights).toContain(4)  // M
    expect(result!.highlights).toContain(11) // L
  })

  it('matches substring in middle', () => {
    const result = fuzzyMatch('useMessageComposer.ts', 'msg')
    expect(result).not.toBeNull()
    expect(result!.highlights).toHaveLength(3)
  })

  it('is case insensitive', () => {
    const result = fuzzyMatch('README.md', 'readme')
    expect(result).not.toBeNull()
    expect(result!.highlights).toHaveLength(6)
  })

  it('scores consecutive matches higher than scattered', () => {
    const consecutive = fuzzyMatch('package.json', 'pack')
    const scattered = fuzzyMatch('path/checker.ts', 'pack')

    expect(consecutive).not.toBeNull()
    // scattered might or might not match — if it does, it should score lower
    if (scattered) {
      expect(consecutive!.score).toBeGreaterThan(scattered.score)
    }
  })

  it('scores word-boundary match higher than mid-word', () => {
    // "input" at word boundary (InputBar) vs mid-word (something with "input" inside)
    const boundary = fuzzyMatch('SessionInputBar', 'Input')
    const midWord = fuzzyMatch('reinputting', 'input')

    expect(boundary).not.toBeNull()
    expect(midWord).not.toBeNull()
    expect(boundary!.score).toBeGreaterThan(midWord!.score)
  })

  it('handles path separators as word boundaries', () => {
    const result = fuzzyMatch('src/components/App.tsx', 'sca')
    expect(result).not.toBeNull()
    // s=src, c=components, a=App — all at word boundaries
    expect(result!.highlights).toHaveLength(3)
  })
})

/* ------------------------------------------------------------------ */
/*  scoreFileEntry                                                     */
/* ------------------------------------------------------------------ */

describe('scoreFileEntry', () => {
  it('returns null when nothing matches', () => {
    const entry = makeEntry('App.tsx', 'src/App.tsx')
    expect(scoreFileEntry(entry, 'xyz')).toBeNull()
  })

  it('gives highest score to exact name match', () => {
    const entry = makeEntry('App.tsx', 'src/App.tsx')
    const result = scoreFileEntry(entry, 'App.tsx')
    expect(result).not.toBeNull()
    expect(result!.score).toBeGreaterThanOrEqual(100)
  })

  it('gives high score to name prefix match', () => {
    const entry = makeEntry('SessionInputBar.tsx', 'src/components/SessionInputBar.tsx')
    const result = scoreFileEntry(entry, 'Session')
    expect(result).not.toBeNull()
    expect(result!.score).toBeGreaterThanOrEqual(70)
  })

  it('applies path depth bonus (shallower files score higher)', () => {
    const shallow = makeEntry('App.tsx', 'App.tsx')
    const deep = makeEntry('App.tsx', 'src/renderer/components/views/App.tsx')

    const shallowResult = scoreFileEntry(shallow, 'App')
    const deepResult = scoreFileEntry(deep, 'App')

    expect(shallowResult).not.toBeNull()
    expect(deepResult).not.toBeNull()
    expect(shallowResult!.score).toBeGreaterThan(deepResult!.score)
  })

  it('includes nameHighlights and pathHighlights', () => {
    const entry = makeEntry('SessionInputBar.tsx', 'src/components/SessionInputBar.tsx')
    const result = scoreFileEntry(entry, 'sib')
    expect(result).not.toBeNull()
    expect(result!.nameHighlights.length).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------------ */
/*  searchFiles                                                        */
/* ------------------------------------------------------------------ */

describe('searchFiles', () => {
  const entries: FileEntry[] = [
    makeEntry('SessionInputBar.tsx', 'src/components/SessionInputBar.tsx'),
    makeEntry('SessionPanel.tsx', 'src/components/SessionPanel.tsx'),
    makeEntry('App.tsx', 'src/App.tsx'),
    makeEntry('FileMentionList.tsx', 'src/components/FileMentionList.tsx'),
    makeEntry('useSession.ts', 'src/hooks/useSession.ts'),
    makeEntry('package.json', 'package.json'),
    makeEntry('src', 'src', true),
    makeEntry('components', 'src/components', true),
  ]

  it('returns all entries (up to maxResults) for empty query', () => {
    const results = searchFiles(entries, '')
    expect(results).toHaveLength(entries.length)
    expect(results[0].score).toBe(0)
  })

  it('filters and scores by query', () => {
    const results = searchFiles(entries, 'session')
    expect(results.length).toBeGreaterThan(0)
    // All results should mention "session" somewhere
    for (const r of results) {
      const combined = (r.entry.name + r.entry.path).toLowerCase()
      expect(combined).toContain('session')
    }
  })

  it('sorts by score descending', () => {
    const results = searchFiles(entries, 'session')
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
    }
  })

  it('respects maxResults option', () => {
    const results = searchFiles(entries, 'session', { maxResults: 2 })
    expect(results.length).toBeLessThanOrEqual(2)
  })

  it('fuzzy matches camelCase (sib → SessionInputBar)', () => {
    const results = searchFiles(entries, 'sib')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].entry.name).toBe('SessionInputBar.tsx')
  })

  it('exact name match ranks first', () => {
    const results = searchFiles(entries, 'package.json')
    expect(results[0].entry.name).toBe('package.json')
  })
})

/* ------------------------------------------------------------------ */
/*  buildHighlightRuns                                                 */
/* ------------------------------------------------------------------ */

describe('buildHighlightRuns', () => {
  it('returns single non-highlighted run when no highlights', () => {
    const runs = buildHighlightRuns('hello', [])
    expect(runs).toEqual([{ text: 'hello', highlighted: false }])
  })

  it('groups consecutive highlighted characters', () => {
    // highlights at 0,1,2 and 5
    const runs = buildHighlightRuns('abcdefg', [0, 1, 2, 5])
    expect(runs).toEqual([
      { text: 'abc', highlighted: true },
      { text: 'de', highlighted: false },
      { text: 'f', highlighted: true },
      { text: 'g', highlighted: false },
    ])
  })

  it('handles single character highlights', () => {
    const runs = buildHighlightRuns('abc', [1])
    expect(runs).toEqual([
      { text: 'a', highlighted: false },
      { text: 'b', highlighted: true },
      { text: 'c', highlighted: false },
    ])
  })

  it('handles all characters highlighted', () => {
    const runs = buildHighlightRuns('hi', [0, 1])
    expect(runs).toEqual([{ text: 'hi', highlighted: true }])
  })
})

/* ------------------------------------------------------------------ */
/*  shouldSkipEntry                                                    */
/* ------------------------------------------------------------------ */

describe('shouldSkipEntry', () => {
  it('skips hidden files (dot prefix)', () => {
    expect(shouldSkipEntry('.git')).toBe(true)
    expect(shouldSkipEntry('.env')).toBe(true)
  })

  it('skips known directories', () => {
    expect(shouldSkipEntry('node_modules')).toBe(true)
    expect(shouldSkipEntry('dist')).toBe(true)
    expect(shouldSkipEntry('__pycache__')).toBe(true)
  })

  it('does not skip normal files', () => {
    expect(shouldSkipEntry('src')).toBe(false)
    expect(shouldSkipEntry('package.json')).toBe(false)
    expect(shouldSkipEntry('README.md')).toBe(false)
  })

  it('SKIP_DIRECTORIES set is consistent with shouldSkipEntry', () => {
    for (const dir of SKIP_DIRECTORIES) {
      expect(shouldSkipEntry(dir)).toBe(true)
    }
  })
})
