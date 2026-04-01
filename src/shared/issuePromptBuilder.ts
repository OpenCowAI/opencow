// SPDX-License-Identifier: Apache-2.0

import type { Issue, IssueImage, UserMessageContent } from './types'
import type { EditorSegment } from './editorSegments'
import { extractSegmentsFromTipTapJson, resolveSlashSegments, type ResolvedBlock } from './slashExpander'
import { buildStructuredContent, type UserMessageBlock } from './contentBuilder'

// ─── Options ──────────────────────────────────────────────────────────────

/** Remote provider metadata injected into the prompt when available. */
export interface IssueRemoteContext {
  platform: 'github' | 'gitlab' | 'linear'
  repoOwner: string
  repoName: string
  remoteNumber: number | null
  remoteUrl: string | null
  remoteState: string | null
  syncStatus: string | null
}

export interface BuildIssuePromptOptions {
  /** Locale-aware call-to-action appended at the end. */
  actionText?: string
  /**
   * Async reader for slash command / skill source files.
   * When provided, slash mention nodes in `richContent` are expanded to their
   * .md body content. When omitted, slash mentions are rendered as `/<name>`.
   */
  readSource?: (sourcePath: string) => Promise<string>
  /** When provided, remote metadata is injected into the prompt context. */
  remoteContext?: IssueRemoteContext | null
}

// ─── Core builder ─────────────────────────────────────────────────────────

/**
 * Build a `UserMessageContent` payload from an Issue, ready for IPC
 * submission to start a session.
 *
 * This is the **single, unified** prompt builder for Issues. It handles
 * all combinations:
 *
 * - Plain-text description (no richContent) → text concatenation
 * - Rich content without slash mentions → text concatenation (fast path)
 * - Rich content with slash mentions + readSource → structured blocks with
 *   slash_command identity preserved
 * - Images → appended as image blocks
 *
 * @example
 * ```ts
 * // Simple (no slash expansion)
 * const prompt = await buildIssuePrompt(issue)
 *
 * // With slash expansion
 * const prompt = await buildIssuePrompt(issue, {
 *   readSource: (path) => api.readCapabilitySource(path),
 *   actionText: t('pleaseWorkOnIssue'),
 * })
 * ```
 */
export async function buildIssuePrompt(
  issue: Pick<Issue, 'title' | 'description' | 'richContent' | 'images'>,
  options: BuildIssuePromptOptions = {},
): Promise<UserMessageContent> {
  const { actionText = 'Please work on this issue.', readSource, remoteContext } = options
  const images: IssueImage[] = issue.images ?? []

  // Fast path: no rich content or no readSource → plain text
  if (!issue.richContent || !readSource) {
    return buildPlainTextPrompt(issue, actionText, images, remoteContext)
  }

  // Parse once, extract segments once — then decide the path
  try {
    const doc = JSON.parse(issue.richContent) as unknown
    const allSegments = extractSegmentsFromTipTapJson(doc)
    const hasSlash = allSegments.some((s) => s.type === 'slashMention')

    if (!hasSlash) {
      return buildPlainTextPrompt(issue, actionText, images, remoteContext)
    }

    // Partition segments by type using type predicates
    type FileMentionSegment = Extract<EditorSegment, { type: 'fileMention' }>
    const fileMentions: FileMentionSegment[] = []
    const nonFileSegments: EditorSegment[] = []
    for (const seg of allSegments) {
      if (seg.type === 'fileMention') {
        fileMentions.push(seg)
      } else {
        nonFileSegments.push(seg)
      }
    }

    // Resolve slash commands → structured blocks
    const { blocks: resolvedBlocks, hasSlashCommands } = await resolveSlashSegments(
      nonFileSegments,
      readSource,
    )

    if (!hasSlashCommands) {
      return buildPlainTextPrompt(issue, actionText, images, remoteContext)
    }

    // Build the final block array (immutable — no mutation of resolvedBlocks)
    const remoteBlock = remoteContext ? `\n${formatRemoteContext(remoteContext)}\n\n` : '\n'
    const blocks = [
      { type: 'text' as const, text: `Issue: ${issue.title}${remoteBlock}` },
      ...prependContextFiles(fileMentions, resolvedBlocks),
      { type: 'text' as const, text: `\n\n${actionText}` },
    ]

    const imageAttachments = images.map((img) => ({
      kind: 'image' as const,
      mediaType: img.mediaType,
      base64Data: img.data,
      sizeBytes: img.sizeBytes,
    }))

    return buildStructuredContent(blocks, imageAttachments)
  } catch (err) {
    // Log expansion failure for debugging, then gracefully degrade to plain text
    console.warn('[issuePromptBuilder] richContent expansion failed, falling back to plain text:', err)
    return buildPlainTextPrompt(issue, actionText, images, remoteContext)
  }
}

// ─── Plain-text helpers (kept for internal use + direct callers) ──────────

/**
 * Build the plain-text prompt string from an Issue.
 *
 * Uses `\n\n` (blank line) between sections to mirror the visual structure
 * of the Issue detail panel.
 */
export function buildIssuePromptText(
  issue: Pick<Issue, 'title' | 'description'>,
  actionText = 'Please work on this issue.',
  remoteContext?: IssueRemoteContext | null,
): string {
  const description = issue.description?.trim()
  const sections = [`Issue: ${issue.title}`]
  if (remoteContext) {
    sections.push(formatRemoteContext(remoteContext))
  }
  if (description) sections.push(description)
  sections.push(actionText)
  return sections.join('\n\n')
}

// ─── Internal ─────────────────────────────────────────────────────────────

/**
 * Prepend `<context-files>` XML to the first text block when file mentions
 * are present. Returns a new array — never mutates `resolvedBlocks`.
 */
function prependContextFiles(
  fileMentions: Extract<EditorSegment, { type: 'fileMention' }>[],
  resolvedBlocks: ResolvedBlock[],
): ResolvedBlock[] {
  if (fileMentions.length === 0) return resolvedBlocks

  const contextLines = fileMentions.map(
    (f) => `- ${f.isDirectory ? '[dir]' : '[file]'} ${f.path}`,
  )
  const contextPrefix = `<context-files>\n${contextLines.join('\n')}\n</context-files>\n\n`

  const result = [...resolvedBlocks]
  if (result.length > 0 && result[0].type === 'text' && result[0].text != null) {
    result[0] = { ...result[0], text: contextPrefix + result[0].text }
  } else {
    result.unshift({ type: 'text', text: contextPrefix })
  }
  return result
}

/**
 * Format remote context as an XML block for injection into the prompt.
 * AI agents can use this to reference the remote issue directly.
 */
function formatRemoteContext(ctx: IssueRemoteContext): string {
  const lines = [
    `<remote-issue-context>`,
    `  platform: ${ctx.platform}`,
    `  repository: ${ctx.repoOwner}/${ctx.repoName}`,
  ]
  if (ctx.remoteNumber != null) lines.push(`  number: #${ctx.remoteNumber}`)
  if (ctx.remoteUrl) lines.push(`  url: ${ctx.remoteUrl}`)
  if (ctx.remoteState) lines.push(`  state: ${ctx.remoteState}`)
  if (ctx.syncStatus) lines.push(`  sync-status: ${ctx.syncStatus}`)
  lines.push(`</remote-issue-context>`)
  return lines.join('\n')
}

function buildPlainTextPrompt(
  issue: Pick<Issue, 'title' | 'description'>,
  actionText: string,
  images: IssueImage[],
  remoteContext?: IssueRemoteContext | null,
): UserMessageContent {
  const text = buildIssuePromptText(issue, actionText, remoteContext)

  if (images.length === 0) return text

  return [
    { type: 'text' as const, text },
    ...images.map((img): UserMessageBlock => ({
      type: 'image' as const,
      mediaType: img.mediaType,
      data: img.data,
      sizeBytes: img.sizeBytes,
    })),
  ]
}
