// SPDX-License-Identifier: Apache-2.0

/**
 * Shared drag-and-drop protocol for project context files/directories.
 *
 * Single source of truth:
 * - MIME type identifier
 * - Payload schema
 * - Payload encode/decode
 */

export const CONTEXT_FILE_DRAG_MIME = 'application/x-opencow-file' as const

export interface ContextFileDescriptor {
  path: string
  name: string
  isDirectory: boolean
}

/**
 * Encode a context file descriptor into the drag payload string.
 */
export function encodeContextFileDragPayload(file: ContextFileDescriptor): string {
  return JSON.stringify({
    path: file.path,
    name: file.name,
    isDirectory: file.isDirectory,
  })
}

/**
 * Decode and validate a drag payload string.
 * Returns null when payload is malformed.
 */
export function decodeContextFileDragPayload(raw: string): ContextFileDescriptor | null {
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null

    const candidate = parsed as Partial<ContextFileDescriptor>
    if (typeof candidate.path !== 'string' || candidate.path.trim() === '') return null
    if (typeof candidate.name !== 'string' || candidate.name.trim() === '') return null
    if (typeof candidate.isDirectory !== 'boolean') return null

    return {
      path: candidate.path,
      name: candidate.name,
      isDirectory: candidate.isDirectory,
    }
  } catch {
    return null
  }
}
