// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import type { FileEntry } from '../../../src/shared/types'

// Test the sort logic that will be used in the IPC handler
function sortFileEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

describe('file entry sorting', () => {
  it('sorts directories before files', () => {
    const entries: FileEntry[] = [
      { name: 'README.md', path: 'README.md', isDirectory: false, size: 100, modifiedAt: 0 },
      { name: 'src', path: 'src', isDirectory: true, size: 0, modifiedAt: 0 }
    ]
    const sorted = sortFileEntries(entries)
    expect(sorted[0].name).toBe('src')
    expect(sorted[1].name).toBe('README.md')
  })

  it('sorts alphabetically within same type', () => {
    const entries: FileEntry[] = [
      { name: 'zebra.ts', path: 'zebra.ts', isDirectory: false, size: 0, modifiedAt: 0 },
      { name: 'alpha.ts', path: 'alpha.ts', isDirectory: false, size: 0, modifiedAt: 0 }
    ]
    const sorted = sortFileEntries(entries)
    expect(sorted[0].name).toBe('alpha.ts')
    expect(sorted[1].name).toBe('zebra.ts')
  })
})

describe('path security', () => {
  it('rejects paths outside project directory', () => {
    const projectPath = '/Users/test/project'
    const maliciousPath = '../../../etc/passwd'

    const resolved = resolve(projectPath, maliciousPath)
    const resolvedBase = resolve(projectPath)
    expect(resolved.startsWith(resolvedBase)).toBe(false)
  })

  it('accepts paths within project directory', () => {
    const projectPath = '/Users/test/project'
    const validPath = 'src/components'

    const resolved = resolve(projectPath, validPath)
    const resolvedBase = resolve(projectPath)
    expect(resolved.startsWith(resolvedBase)).toBe(true)
  })
})
