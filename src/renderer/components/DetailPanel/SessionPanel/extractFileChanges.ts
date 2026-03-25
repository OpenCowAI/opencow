// SPDX-License-Identifier: Apache-2.0

/**
 * extractFileChanges — Pure data extraction for file changes from session messages.
 *
 * Scans ManagedSessionMessage[] for Write / Edit / NotebookEdit tool_use blocks,
 * groups them by file path, and returns a structured result for the diff viewer.
 *
 * Also re-exports diff computation utilities (moved from ToolUseBlockView) so that
 * both the inline diff in ToolUseBlockView and the DiffChangesDialog share the same code.
 */
import type { ManagedSessionMessage } from '@shared/types'

// ─── Types ──────────────────────────────────────────────────────────────────

/** A single file-modifying operation extracted from a tool_use block. */
export interface FileOperation {
  /** Operation type */
  type: 'write' | 'edit' | 'notebook_edit'
  /** tool_use block ID (for dedup / tracing) */
  toolUseId: string
  /** Message timestamp */
  timestamp: number
  /** Write only: full file content */
  content?: string
  /** Edit only: replaced text */
  oldString?: string
  /** Edit only: replacement text */
  newString?: string
  /** Edit only: replace all occurrences */
  replaceAll?: boolean
}

/** Aggregated changes for a single file. */
export interface FileChange {
  /** Absolute file path */
  filePath: string
  /** Base file name */
  fileName: string
  /** Change category */
  changeType: 'created' | 'modified' | 'created_and_modified'
  /** Chronologically ordered operations */
  operations: FileOperation[]
  /** Timestamp of last modification */
  lastModifiedAt: number
}

/** Result of extractFileChanges. */
export interface FileChangesResult {
  /** Changed files sorted by last modification (most recent first) */
  files: FileChange[]
  /** Summary statistics */
  stats: {
    totalFiles: number
    createdFiles: number
    modifiedFiles: number
    totalOperations: number
  }
}

// ─── Core extraction ────────────────────────────────────────────────────────

/**
 * Extract all file changes from a set of messages.
 *
 * Scans assistant messages for Write / Edit / NotebookEdit tool_use blocks,
 * groups by file_path, and sorts by last modification time.
 */
export function extractFileChanges(messages: ManagedSessionMessage[]): FileChangesResult {
  const map = new Map<string, { ops: FileOperation[]; hasWrite: boolean; hasEdit: boolean }>()

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const block of msg.content) {
      if (block.type !== 'tool_use') continue

      if (block.name === 'Write') {
        const filePath = block.input.file_path as string | undefined
        if (!filePath) continue
        const entry = map.get(filePath) ?? { ops: [], hasWrite: false, hasEdit: false }
        entry.hasWrite = true
        entry.ops.push({
          type: 'write',
          toolUseId: block.id,
          timestamp: msg.timestamp,
          content: block.input.content != null ? String(block.input.content) : undefined,
        })
        map.set(filePath, entry)
      }

      if (block.name === 'Edit') {
        const filePath = block.input.file_path as string | undefined
        if (!filePath) continue
        const entry = map.get(filePath) ?? { ops: [], hasWrite: false, hasEdit: false }
        entry.hasEdit = true
        entry.ops.push({
          type: 'edit',
          toolUseId: block.id,
          timestamp: msg.timestamp,
          oldString: block.input.old_string != null ? String(block.input.old_string) : undefined,
          newString: block.input.new_string != null ? String(block.input.new_string) : undefined,
          replaceAll: block.input.replace_all === true,
        })
        map.set(filePath, entry)
      }

      if (block.name === 'NotebookEdit') {
        const filePath = block.input.notebook_path as string | undefined
        if (!filePath) continue
        const entry = map.get(filePath) ?? { ops: [], hasWrite: false, hasEdit: false }
        entry.hasEdit = true
        entry.ops.push({
          type: 'notebook_edit',
          toolUseId: block.id,
          timestamp: msg.timestamp,
          newString: block.input.new_source != null ? String(block.input.new_source) : undefined,
        })
        map.set(filePath, entry)
      }
    }
  }

  const files: FileChange[] = Array.from(map.entries())
    .map(([filePath, { ops, hasWrite, hasEdit }]) => ({
      filePath,
      fileName: filePath.split('/').pop() ?? filePath,
      changeType: (
        hasWrite && hasEdit ? 'created_and_modified'
          : hasWrite ? 'created'
            : 'modified'
      ) as FileChange['changeType'],
      operations: ops.sort((a, b) => a.timestamp - b.timestamp),
      lastModifiedAt: Math.max(...ops.map((o) => o.timestamp)),
    }))
    .sort((a, b) => b.lastModifiedAt - a.lastModifiedAt)

  return {
    files,
    stats: {
      totalFiles: files.length,
      createdFiles: files.filter((f) => f.changeType === 'created' || f.changeType === 'created_and_modified').length,
      modifiedFiles: files.filter((f) => f.changeType === 'modified' || f.changeType === 'created_and_modified').length,
      totalOperations: files.reduce((sum, f) => sum + f.operations.length, 0),
    },
  }
}

// ─── Turn boundary helpers ──────────────────────────────────────────────────

/**
 * Check whether any message in the range contains Write / Edit / NotebookEdit
 * tool calls. Short-circuits on first match for performance.
 */
export function hasFileChanges(messages: ManagedSessionMessage[]): boolean {
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const block of msg.content) {
      if (
        block.type === 'tool_use' &&
        (block.name === 'Write' || block.name === 'Edit' || block.name === 'NotebookEdit')
      ) {
        return true
      }
    }
  }
  return false
}

/**
 * Count distinct files modified in the given messages.
 * Lightweight — only collects unique file paths without building full FileChange objects.
 */
export function countChangedFiles(messages: ManagedSessionMessage[]): number {
  const paths = new Set<string>()
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const block of msg.content) {
      if (block.type !== 'tool_use') continue
      if (block.name === 'Write' || block.name === 'Edit') {
        const fp = block.input.file_path as string | undefined
        if (fp) paths.add(fp)
      } else if (block.name === 'NotebookEdit') {
        const fp = block.input.notebook_path as string | undefined
        if (fp) paths.add(fp)
      }
    }
  }
  return paths.size
}

// ─── Diff computation (shared) ──────────────────────────────────────────────

export interface DiffLine {
  type: 'removed' | 'added' | 'context'
  content: string
}

/**
 * Compute a simple inline diff between old_string and new_string.
 * Returns lines annotated with type for colouring.
 * Uses a basic line-by-line LCS comparison (sufficient for typical code edits).
 */
export function computeInlineDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')
  const lines: DiffLine[] = []

  const lcs = buildLCS(oldLines, newLines)
  let oi = 0
  let ni = 0
  let li = 0

  while (oi < oldLines.length || ni < newLines.length) {
    if (
      li < lcs.length &&
      oi < oldLines.length &&
      ni < newLines.length &&
      oldLines[oi] === lcs[li] &&
      newLines[ni] === lcs[li]
    ) {
      lines.push({ type: 'context', content: lcs[li] })
      oi++
      ni++
      li++
    } else if (oi < oldLines.length && (li >= lcs.length || oldLines[oi] !== lcs[li])) {
      lines.push({ type: 'removed', content: oldLines[oi] })
      oi++
    } else if (ni < newLines.length && (li >= lcs.length || newLines[ni] !== lcs[li])) {
      lines.push({ type: 'added', content: newLines[ni] })
      ni++
    } else {
      break
    }
  }

  return lines
}

/**
 * Build a Longest Common Subsequence (LCS) of lines.
 */
export function buildLCS(a: string[], b: string[]): string[] {
  const m = a.length
  const n = b.length
  // For very large inputs, fall back to simple sequential diff
  if (m * n > 100_000) {
    return simpleFallbackLCS(a, b)
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  const result: string[] = []
  let i = m
  let j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1])
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }
  return result
}

/**
 * Simple fallback for very large diffs — just match consecutive equal lines.
 */
function simpleFallbackLCS(a: string[], b: string[]): string[] {
  const result: string[] = []
  let j = 0
  for (let i = 0; i < a.length && j < b.length; i++) {
    if (a[i] === b[j]) {
      result.push(a[i])
      j++
    }
  }
  return result
}
