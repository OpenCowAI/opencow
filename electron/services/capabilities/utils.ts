// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'
import type { CapabilityEntryBase, CapabilitySource, CapabilityScope } from '@shared/types'
import { parseFrontmatter } from '@shared/frontmatter'

/** Safely read directory entries; returns empty array if dir doesn't exist */
export async function safeReaddir(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    return entries.filter(e => e.isFile() || e.isDirectory()).map(e => e.name)
  } catch {
    return []
  }
}

/** Safely list directory entries with dirent info */
export async function safeDirEntries(dirPath: string): Promise<Array<{ name: string; isDir: boolean }>> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    return entries.map(e => ({ name: e.name, isDir: e.isDirectory() }))
  } catch {
    return []
  }
}

/** Safely read file content; returns null if file doesn't exist */
export async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

/** Safely parse JSON from a file path; returns empty object on failure */
export async function safeReadJson(filePath: string): Promise<Record<string, unknown>> {
  const content = await safeReadFile(filePath)
  if (!content) return {}
  try {
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Build a CapabilitySource for a user-directory or project-directory origin */
export function makeSource(scope: CapabilityScope, sourcePath: string): CapabilitySource {
  return {
    scope,
    origin: scope === 'project' ? 'project' : 'user',
    sourcePath,
  }
}

/** Scan a directory of .md files, parsing frontmatter and calling `extract` for per-type fields */
export async function scanMdDir<T extends CapabilityEntryBase>(
  dirPath: string,
  scope: CapabilityScope,
  extract: (fm: Record<string, unknown>, name: string) => Omit<T, keyof CapabilityEntryBase>
): Promise<T[]> {
  const entries = await safeDirEntries(dirPath)
  const results: T[] = []

  for (const entry of entries) {
    if (entry.isDir || !entry.name.endsWith('.md')) continue
    const fullPath = path.join(dirPath, entry.name)
    const content = await safeReadFile(fullPath)
    const fm = content ? parseFrontmatter(content).attributes : {}
    const name = entry.name.replace('.md', '')

    results.push({
      name: (fm['name'] as string) ?? name,
      description: (fm['description'] as string) ?? '',
      source: makeSource(scope, fullPath),
      ...extract(fm, name),
    } as T)
  }

  return results.sort((a, b) => a.name.localeCompare(b.name))
}

/** Sort helper — sort CapabilityEntryBase items by name */
export function byName(a: CapabilityEntryBase, b: CapabilityEntryBase): number {
  return a.name.localeCompare(b.name)
}
