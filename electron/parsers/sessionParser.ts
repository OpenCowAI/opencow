// SPDX-License-Identifier: Apache-2.0

import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import type { SessionStatus } from '@shared/types'
import { sanitizeSessionName, type SanitizedName } from './sessionNameSanitizer'
import { readLinesFromStream } from '../io/safeReadLines'

const CLAUDE_DIR = join(homedir(), '.claude')
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects')

const ACTIVE_THRESHOLD_MS = 30_000
const WAITING_THRESHOLD_MS = 5 * 60_000

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MAX_SCAN_LINES = 500 // Safety limit: scan at most 500 lines

export function inferStatus(lastActivityMs: number, now: number): SessionStatus {
  const elapsed = now - lastActivityMs
  if (elapsed < ACTIVE_THRESHOLD_MS) return 'active'
  if (elapsed < WAITING_THRESHOLD_MS) return 'waiting'
  return 'completed'
}

// === Session File Discovery ===

export interface SessionFileInfo {
  sessionId: string
  jsonlPath: string
  lastModified: number
  /** File size in bytes — used as cache invalidation key alongside lastModified. */
  size: number
}

async function findSessionFiles(projectDir: string): Promise<SessionFileInfo[]> {
  const entries = await readdir(projectDir)
  const sessions: SessionFileInfo[] = []

  for (const entry of entries) {
    if (!entry.endsWith('.jsonl')) continue

    const sessionId = entry.replace('.jsonl', '')
    if (!UUID_PATTERN.test(sessionId)) continue

    const filePath = join(projectDir, entry)
    const fileStat = await stat(filePath).catch(() => null)
    if (!fileStat || !fileStat.isFile()) continue

    sessions.push({
      sessionId,
      jsonlPath: filePath,
      lastModified: fileStat.mtimeMs,
      size: fileStat.size,
    })
  }

  return sessions
}

// === Session Metadata Parsing ===

export interface SessionMetadata {
  cwd: string
  gitBranch: string | null
  startedAt: number
  /** First valid user message (structured, includes commandName) */
  firstUserMessage: SanitizedName | null
  /** Latest user message (only populated when different from firstUserMessage) */
  latestUserMessage: SanitizedName | null
}

type JsonlEntry = {
  type?: string
  message?: { content?: string | unknown[] }
  cwd?: string
  gitBranch?: string
  timestamp?: string
}

/**
 * Extract raw text (unsanitized) from a JSONL entry's message.content.
 */
function getRawUserText(entry: JsonlEntry): string | null {
  if (entry.type !== 'user' || !entry.message?.content) return null

  const content = entry.message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const textBlock = content.find((b: unknown) => (b as { type: string }).type === 'text') as
      | { text?: string }
      | undefined
    return textBlock?.text || null
  }
  return null
}

/**
 * Detect whether a JSONL entry is a Skill/Command invocation entry.
 * These entries are followed by a system-injected skill template (also marked type=user),
 * which must be skipped to avoid misidentifying the skill template as a user message.
 */
function isCommandInvocationEntry(entry: JsonlEntry): boolean {
  const raw = getRawUserText(entry)
  return raw !== null && (raw.includes('<command-message>') || raw.includes('<command-name>'))
}

/**
 * Extract a structured user message from a JSONL entry's message.content.
 * Returns null to indicate the message is noise and should be skipped.
 */
function extractUserMessage(entry: JsonlEntry): SanitizedName | null {
  const rawText = getRawUserText(entry)
  if (!rawText) return null
  return sanitizeSessionName(rawText)
}

const INITIAL_TAIL_BYTES = 512 * 1024 // 512KB

/** Combined result from a tail scan — captures messages, cwd, and gitBranch in one pass. */
interface TailScanResult {
  latestMessage: SanitizedName | null
  /** Latest cwd seen in the scanned region (null if none found). */
  latestCwd: string | null
  /** Latest gitBranch seen in the scanned region (null if none found). */
  latestGitBranch: string | null
}

/**
 * Scan from the given start offset in jsonlPath and return:
 * - The last valid user message (structured)
 * - The latest cwd and gitBranch values (for worktree change detection)
 *
 * If skipFirstLine is true, skip the first line (may be truncated due to offset).
 *
 * Skill template skipping: after each skill/command invocation (entries containing <command-message>),
 * Claude Code injects a type=user skill template definition that must be skipped.
 */
async function scanFromOffset(
  jsonlPath: string,
  start: number,
  skipFirstLine: boolean
): Promise<TailScanResult> {
  const lines = await readLinesFromStream(jsonlPath, { start })

  let isFirstLine = skipFirstLine
  let latestMessage: SanitizedName | null = null
  let latestCwd: string | null = null
  let latestGitBranch: string | null = null
  let skipNextUserEntry = false

  for (const line of lines) {
    if (isFirstLine) {
      isFirstLine = false
      continue
    }

    try {
      const entry = JSON.parse(line) as JsonlEntry

      // Track latest cwd/gitBranch — always overwrite to capture the most recent value
      if (entry.cwd) latestCwd = entry.cwd
      if (entry.gitBranch) latestGitBranch = entry.gitBranch

      // The next user entry after a Skill/Command invocation is a system-injected skill template — skip it
      if (entry.type === 'user' && skipNextUserEntry) {
        skipNextUserEntry = false
        continue
      }

      if (isCommandInvocationEntry(entry)) {
        skipNextUserEntry = true
      }

      const sanitized = extractUserMessage(entry)
      if (sanitized) {
        latestMessage = sanitized
      }
    } catch {
      continue
    }
  }

  return { latestMessage, latestCwd, latestGitBranch }
}

/**
 * Adaptive tail scan: first read the last 512KB; if no valid user message is found, fall back to full file scan.
 * For the vast majority of sessions (tail < 512KB contains a user message), only one I/O is needed.
 *
 * Returns the combined TailScanResult including latest user message AND latest cwd/gitBranch.
 */
async function scanTailData(jsonlPath: string): Promise<TailScanResult> {
  const empty: TailScanResult = { latestMessage: null, latestCwd: null, latestGitBranch: null }
  let fileSize: number
  try {
    const fileStat = await stat(jsonlPath)
    fileSize = fileStat.size
  } catch {
    return empty
  }

  if (fileSize === 0) return empty

  // Adaptive expansion: 512KB -> full file
  const tailSizes = [INITIAL_TAIL_BYTES, fileSize]

  for (const tailBytes of tailSizes) {
    const start = Math.max(0, fileSize - tailBytes)
    const skipFirstLine = start > 0

    try {
      const result = await scanFromOffset(jsonlPath, start, skipFirstLine)
      // Consider the scan successful if we found a user message OR git info
      if (result.latestMessage || result.latestCwd || result.latestGitBranch) return result
    } catch {
      // I/O error, try the next window
    }

    if (start === 0) break // Already scanned the entire file
  }

  return empty
}

/**
 * Bidirectional scan to extract session metadata:
 * 1. Forward scan: extract cwd, gitBranch, startedAt, firstUserMessage from the file head
 * 2. Tail scan: extract latestUserMessage from the file tail
 */
export async function parseSessionMetadata(jsonlPath: string): Promise<SessionMetadata> {
  let cwd = ''
  let gitBranch: string | null = null
  let startedAt = 0
  let firstUserMessage: SanitizedName | null = null

  try {
    const lines = await readLinesFromStream(jsonlPath, { maxLines: MAX_SCAN_LINES })
    let skipNextUserEntry = false

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as JsonlEntry

        if (entry.cwd && !cwd) {
          cwd = entry.cwd
        }
        if (entry.gitBranch && !gitBranch) {
          gitBranch = entry.gitBranch
        }
        if (entry.timestamp && startedAt === 0) {
          startedAt = new Date(entry.timestamp).getTime()
        }
        if (!firstUserMessage) {
          // The next user entry after a Skill/Command invocation is a system-injected skill template — skip it
          if (entry.type === 'user' && skipNextUserEntry) {
            skipNextUserEntry = false
          } else {
            if (isCommandInvocationEntry(entry)) {
              skipNextUserEntry = true
            }
            const sanitized = extractUserMessage(entry)
            if (sanitized) {
              firstUserMessage = sanitized
            }
          }
        }
      } catch {
        continue
      }

      if (firstUserMessage) break
    }
  } catch {
    // File read error, return defaults
  }

  const tailData = await scanTailData(jsonlPath)

  return {
    // Prefer the latest cwd/gitBranch from the tail scan (reflects worktree switches)
    cwd: tailData.latestCwd || cwd,
    gitBranch: tailData.latestGitBranch || gitBranch,
    startedAt: startedAt || Date.now(),
    firstUserMessage,
    latestUserMessage:
      tailData.latestMessage && tailData.latestMessage.text !== firstUserMessage?.text
        ? tailData.latestMessage
        : null,
  }
}

/** Raw discovery result — no OpenCow IDs assigned yet. */
export interface DiscoveredProjectData {
  folderName: string
  /** Populated by the caller (sessionSource) using cached metadata. */
  resolvedPath: string
  /** Populated by the caller (sessionSource) using cached metadata. */
  name: string
  sessionFiles: SessionFileInfo[]
}

/**
 * Discover Claude Code projects from ~/.claude/projects/.
 *
 * Pure discovery: enumerates folders and session files, but does NOT
 * parse any JSONL content. resolvedPath and name are left as defaults
 * and must be filled in by the caller using a metadata cache.
 *
 * This avoids N×parseSessionMetadata() calls inside discovery —
 * the former resolveProjectPath() was the biggest FD leak amplifier.
 */
export async function discoverProjects(): Promise<DiscoveredProjectData[]> {
  let entries: string[]
  try {
    entries = await readdir(PROJECTS_DIR)
  } catch {
    return []
  }

  const results: DiscoveredProjectData[] = []

  for (const folderName of entries) {
    if (folderName.startsWith('.')) continue
    const projectDir = join(PROJECTS_DIR, folderName)
    const folderStat = await stat(projectDir).catch(() => null)
    if (!folderStat?.isDirectory()) continue

    const sessionFiles = await findSessionFiles(projectDir)
    results.push({ folderName, resolvedPath: '', name: folderName, sessionFiles })
  }

  return results
}

export { CLAUDE_DIR, PROJECTS_DIR }
