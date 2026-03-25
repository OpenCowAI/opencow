// SPDX-License-Identifier: Apache-2.0

/**
 * reviewChatUtils — Builds the AI context prompt for review chat sessions.
 *
 * Converts FileChangesResult into a structured system prompt so the AI
 * understands what code is being reviewed in the DiffChangesDialog.
 */
import type { FileChangesResult, FileChange, FileOperation } from './extractFileChanges'
import type { ReviewContext } from './reviewTypes'
import { truncate as unicodeTruncate } from '@shared/unicode'

/** Maximum characters per file in the context prompt. */
const MAX_CHARS_PER_FILE = 3000
/** Maximum total characters for all file content in the context prompt. */
const MAX_TOTAL_CHARS = 15000

/**
 * Build a context system prompt describing the file changes being reviewed.
 * Injected as `contextSystemPrompt` when creating a review session.
 */
export function buildReviewContextPrompt(
  fileChanges: FileChangesResult,
  context: ReviewContext,
): string {
  const lines: string[] = [
    '## Code Review Context',
    '',
    'You are assisting with a code review. The user is viewing file changes',
    'from a development session and will ask questions about them.',
    'Be concise, precise, and helpful. Reference specific files and line changes when relevant.',
    '',
    `- Issue ID: ${context.issueId}`,
    `- Session ID: ${context.sessionId}`,
    `- Review scope: ${context.scope.type === 'session' ? 'all session changes' : 'single turn changes'}`,
    `- Total files changed: ${fileChanges.stats.totalFiles}`,
  ]

  const parts: string[] = []
  if (fileChanges.stats.createdFiles > 0) parts.push(`${fileChanges.stats.createdFiles} created`)
  if (fileChanges.stats.modifiedFiles > 0) parts.push(`${fileChanges.stats.modifiedFiles} modified`)
  if (parts.length > 0) lines.push(`- Breakdown: ${parts.join(', ')}`)
  lines.push('')

  // Build per-file change summaries (token-budget aware)
  lines.push('### Changed Files')
  let totalChars = 0

  for (const file of fileChanges.files) {
    if (totalChars >= MAX_TOTAL_CHARS) {
      const remaining = fileChanges.files.length - fileChanges.files.indexOf(file)
      lines.push('')
      lines.push(`_(${remaining} more files omitted for brevity)_`)
      break
    }

    const fileSection = buildFileSection(file, MAX_TOTAL_CHARS - totalChars)
    totalChars += fileSection.charCount
    lines.push('')
    lines.push(...fileSection.lines)
  }

  return lines.join('\n')
}

// ─── Internal helpers ────────────────────────────────────────────────────────

interface SectionResult {
  lines: string[]
  charCount: number
}

function buildFileSection(file: FileChange, remainingBudget: number): SectionResult {
  const lines: string[] = []
  let charCount = 0
  const budget = Math.min(MAX_CHARS_PER_FILE, remainingBudget)

  lines.push(`#### \`${file.filePath}\` (${file.changeType})`)

  for (const op of file.operations) {
    if (charCount >= budget) {
      lines.push('_(remaining operations truncated)_')
      break
    }

    const opResult = formatOperation(op, budget - charCount)
    charCount += opResult.charCount
    lines.push(...opResult.lines)
  }

  return { lines, charCount }
}

function formatOperation(op: FileOperation, budget: number): SectionResult {
  const lines: string[] = []
  let charCount = 0

  if (op.type === 'write' && op.content) {
    const content = truncate(op.content, budget)
    charCount += content.length
    lines.push('New file content:')
    lines.push('```')
    lines.push(content)
    lines.push('```')
  } else if (op.type === 'edit') {
    if (op.oldString) {
      const old = truncate(op.oldString, Math.floor(budget / 2))
      charCount += old.length
      lines.push('Removed:')
      lines.push('```')
      lines.push(old)
      lines.push('```')
    }
    if (op.newString) {
      const newStr = truncate(op.newString, budget - charCount)
      charCount += newStr.length
      lines.push('Added:')
      lines.push('```')
      lines.push(newStr)
      lines.push('```')
    }
  } else if (op.type === 'notebook_edit' && op.newString) {
    const content = truncate(op.newString, budget)
    charCount += content.length
    lines.push('Notebook cell updated:')
    lines.push('```')
    lines.push(content)
    lines.push('```')
  }

  return { lines, charCount }
}

function truncate(text: string, maxLen: number): string {
  return unicodeTruncate(text, { max: maxLen, ellipsis: '\n... (truncated)' })
}
