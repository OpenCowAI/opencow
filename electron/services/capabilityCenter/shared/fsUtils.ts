// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'

/**
 * Shared file-system utilities for the Capability Center subsystem.
 *
 * v3.1 fix #27: centralize FS helpers to avoid duplication across
 * CapabilityStore, ImportPipeline, and DiscoveryEngine.
 */

/** A single directory entry with type info. */
export interface DirEntry {
  name: string
  isDir: boolean
  isFile: boolean
}

/** Safely list directory entries with type info; returns empty array if dir doesn't exist */
export async function safeDirEntries(dirPath: string): Promise<DirEntry[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    return entries.map((e) => ({
      name: e.name,
      isDir: e.isDirectory(),
      isFile: e.isFile(),
    }))
  } catch {
    return []
  }
}

/** Safely read file as UTF-8 string; returns null if file doesn't exist */
export async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

/** Safely read and parse a JSON file; returns empty object on failure */
export async function safeReadJson(
  filePath: string,
): Promise<Record<string, unknown>> {
  const content = await safeReadFile(filePath)
  if (!content) return {}
  try {
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return {}
  }
}
