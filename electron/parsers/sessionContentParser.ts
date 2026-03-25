// SPDX-License-Identifier: Apache-2.0

import { readAllLines } from '../io/safeReadLines'
import { basename } from 'path'
import type {
  SessionContent,
  ConversationTurn,
  ToolCallSummary,
  SessionStats,
  TurnImage
} from '@shared/types'
import { sanitizeSessionName } from './sessionNameSanitizer'
import { truncate } from '@shared/unicode'

const MAX_RESPONSE_LENGTH = 200

// === JSONL Entry Types (internal) ===

interface ContentBlock {
  type: string
  text?: string
  name?: string
  id?: string
  input?: Record<string, unknown>
  source?: { type: string; media_type: string; data: string }
}

interface RawEntry {
  type: string
  timestamp: string
  uuid?: string
  isMeta?: boolean
  isSidechain?: boolean
  message?: {
    role: string
    content: string | ContentBlock[]
  }
  toolUseResult?: {
    durationMs?: number
  }
  sourceToolAssistantUUID?: string
}

// === Tool Target Extraction ===

function extractToolTarget(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return basename(String(input.file_path ?? ''))
    case 'Glob':
      return String(input.pattern ?? '')
    case 'Grep':
      return String(input.pattern ?? '')
    case 'Bash':
      return String(input.command ?? '').split('\n')[0].slice(0, 80)
    case 'Task':
      return String(input.description ?? '')
    case 'Skill':
      return String(input.skill ?? '')
    case 'WebSearch':
      return String(input.query ?? '')
    case 'WebFetch':
      return String(input.url ?? '').slice(0, 80)
    default:
      return ''
  }
}

function extractFilePath(tool: string, input: Record<string, unknown>): string | null {
  if (tool === 'Read' || tool === 'Write' || tool === 'Edit') {
    const fp = input.file_path
    return typeof fp === 'string' ? fp : null
  }
  return null
}

// === Turn Boundary Detection ===

/**
 * Extract text content from a user message entry.
 * Supports both string and array (with text blocks) content formats.
 * Returns null for non-user-text messages (e.g. tool_result, meta, etc.).
 */
function extractUserText(entry: RawEntry): string | null {
  if (entry.type !== 'user') return null
  if (entry.isMeta) return null

  const content = entry.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    // tool_result entries are not user text messages
    if (content.some((b: ContentBlock) => b.type === 'tool_result')) return null
    const textBlock = content.find((b: ContentBlock) => b.type === 'text' && b.text)
    return textBlock?.text ?? null
  }
  return null
}

/**
 * Extract images from a user message entry.
 * Returns a TurnImage array; returns an empty array when there are no images.
 */
function extractUserImages(entry: RawEntry): TurnImage[] {
  if (entry.type !== 'user') return []
  const content = entry.message?.content
  if (!Array.isArray(content)) return []

  const images: TurnImage[] = []
  for (const block of content as ContentBlock[]) {
    if (block.type === 'image' && block.source?.data) {
      const { media_type, data } = block.source
      const sizeBytes = Math.floor((data.length * 3) / 4)
      images.push({
        dataUri: `data:${media_type};base64,${data}`,
        mediaType: media_type,
        sizeBytes
      })
    }
  }
  return images
}

function isToolResultEntry(entry: RawEntry): boolean {
  if (entry.type !== 'user') return false
  const content = entry.message?.content
  if (!Array.isArray(content)) return false
  return content.some((b: ContentBlock) => b.type === 'tool_result')
}

const NOISE_TYPES = new Set([
  'progress',
  'system',
  'file-history-snapshot',
  'queue-operation'
])

// === Turn Builder ===

interface TurnBuilder {
  turnIndex: number
  userMessage: string
  images: TurnImage[]
  assistantResponse: string
  toolCalls: ToolCallSummary[]
  filePathSet: Set<string>
  startedAt: number
  endedAt: number
  pendingToolIndices: Map<string, number[]>
}

function createTurnBuilder(
  turnIndex: number,
  userMessage: string,
  images: TurnImage[],
  timestamp: number
): TurnBuilder {
  return {
    turnIndex,
    userMessage,
    images,
    assistantResponse: '',
    toolCalls: [],
    filePathSet: new Set(),
    startedAt: timestamp,
    endedAt: timestamp,
    pendingToolIndices: new Map()
  }
}

function finalizeTurn(builder: TurnBuilder): ConversationTurn {
  return {
    turnIndex: builder.turnIndex,
    userMessage: builder.userMessage,
    assistantResponse: builder.assistantResponse,
    toolCalls: builder.toolCalls,
    filesAffected: Array.from(builder.filePathSet),
    images: builder.images,
    startedAt: builder.startedAt,
    endedAt: builder.endedAt
  }
}

function computeStats(turns: ConversationTurn[]): SessionStats {
  const toolBreakdown: Record<string, number> = {}
  const allFiles = new Set<string>()
  let totalToolCalls = 0

  for (const turn of turns) {
    for (const tc of turn.toolCalls) {
      totalToolCalls++
      toolBreakdown[tc.tool] = (toolBreakdown[tc.tool] ?? 0) + 1
    }
    for (const f of turn.filesAffected) {
      allFiles.add(f)
    }
  }

  // Sum each turn's active duration (excludes user idle time between turns)
  let durationMs = 0
  for (const turn of turns) {
    durationMs += turn.endedAt - turn.startedAt
  }

  return {
    durationMs,
    turnCount: turns.length,
    toolCallCount: totalToolCalls,
    filesAffected: Array.from(allFiles),
    toolBreakdown
  }
}

/**
 * Extract session content from a pre-parsed array of JSONL lines.
 * Pure function, easy to test.
 */
export function parseSessionContentFromLines(lines: string[]): SessionContent {
  const turns: ConversationTurn[] = []
  let current: TurnBuilder | null = null

  for (const line of lines) {
    if (!line.trim()) continue

    let entry: RawEntry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }

    // Skip noise
    if (NOISE_TYPES.has(entry.type)) continue
    if (entry.isSidechain) continue

    const ts = new Date(entry.timestamp).getTime()

    // Turn boundary: user text message
    const userText = extractUserText(entry)
    if (userText !== null) {
      const sanitized = sanitizeSessionName(userText)

      if (!sanitized) continue // Noise message, skip

      if (current) {
        turns.push(finalizeTurn(current))
      }
      const images = extractUserImages(entry)
      current = createTurnBuilder(turns.length, sanitized.text, images, ts)
      continue
    }

    if (!current) continue

    // Update endedAt for all relevant entries
    if (ts > current.endedAt) {
      current.endedAt = ts
    }

    // Assistant entries
    if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
      const content = entry.message!.content as ContentBlock[]
      const entryUuid = entry.uuid

      for (const block of content) {
        // First text block → assistantResponse
        if (block.type === 'text' && block.text && !current.assistantResponse) {
          let text = block.text.trim()
          text = truncate(text, { max: MAX_RESPONSE_LENGTH })
          current.assistantResponse = text
        }

        // Tool use → add to toolCalls
        if (block.type === 'tool_use' && block.name) {
          const input = block.input ?? {}
          const target = extractToolTarget(block.name, input)
          const filePath = extractFilePath(block.name, input)

          if (filePath) {
            current.filePathSet.add(filePath)
          }

          const idx = current.toolCalls.length
          current.toolCalls.push({
            tool: block.name,
            target,
            durationMs: 0
          })

          // Track for duration matching
          if (entryUuid) {
            if (!current.pendingToolIndices.has(entryUuid)) {
              current.pendingToolIndices.set(entryUuid, [])
            }
            current.pendingToolIndices.get(entryUuid)!.push(idx)
          }
        }
      }
    }

    // Tool result → update duration
    if (isToolResultEntry(entry)) {
      const sourceUuid = entry.sourceToolAssistantUUID
      const durationMs = entry.toolUseResult?.durationMs

      if (sourceUuid && typeof durationMs === 'number') {
        const indices = current.pendingToolIndices.get(sourceUuid)
        if (indices?.length) {
          const idx = indices.shift()!
          if (idx < current.toolCalls.length) {
            current.toolCalls[idx].durationMs = durationMs
          }
        }
      }
    }
  }

  // Finalize last turn
  if (current) {
    turns.push(finalizeTurn(current))
  }

  return {
    turns,
    stats: computeStats(turns)
  }
}

/**
 * Parse full session content from a JSONL file.
 * Uses readAllLines() (fs.readFile) — zero FD leak risk.
 */
export async function parseSessionContent(
  jsonlPath: string
): Promise<SessionContent> {
  const lines = await readAllLines(jsonlPath)
  return parseSessionContentFromLines(lines)
}
