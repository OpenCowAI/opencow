// SPDX-License-Identifier: Apache-2.0

/**
 * MessageRenderers — User message components for both CLI and chat variants.
 *
 * Extracted from SessionMessageList.tsx for single-responsibility:
 * these components handle pure rendering of user messages with no
 * scroll, virtualization, or data pipeline concerns.
 */

import { memo } from 'react'
import { LinkifiedText } from '@/components/ui/LinkifiedText'
import { ContentBlockRenderer } from './ContentBlockRenderer'
import { ContextFileChips } from '@/components/ui/ContextFileChips'
import { parseContextFiles } from '@/lib/contextFilesParsing'
import { getSlashDisplayLabel } from '@shared/slashDisplay'
import { extractUserText } from './messageDisplayUtils'
import type { ContentBlock, SlashCommandBlock } from '@shared/types'

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function UserTextWithContext({ text, className }: { text: string; className?: string }): React.JSX.Element {
  const { files, rest } = parseContextFiles(text)
  return (
    <>
      {files.length > 0 && (
        <div className="mb-1">
          <ContextFileChips files={files} />
        </div>
      )}
      {rest.trim() && <LinkifiedText text={rest} className={className} />}
    </>
  )
}

function SlashCommandChip({ block }: { block: SlashCommandBlock }): React.JSX.Element {
  const label = getSlashDisplayLabel(block)
  return (
    <span className="slash-mention" role="img" aria-label={`Slash command: ${label}`}>
      /{label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Shared rendering — deduplicates the image-grouping IIFE that was
// previously copy-pasted in UserMessage and ChatBubbleUserMessage.
// ---------------------------------------------------------------------------

function renderUserContentBlocks(
  content: ContentBlock[],
  textClassName?: string,
): React.ReactNode[] {
  const elements: React.ReactNode[] = []
  let imageGroup: React.ReactNode[] = []

  const flushImages = () => {
    if (imageGroup.length > 0) {
      elements.push(
        <div key={`img-group-${elements.length}`} className="flex flex-wrap gap-1.5 py-0.5">
          {imageGroup}
        </div>,
      )
      imageGroup = []
    }
  }

  content.forEach((block, i) => {
    if (block.type === 'image') {
      imageGroup.push(<ContentBlockRenderer key={i} block={block} />)
    } else {
      flushImages()
      if (block.type === 'text') elements.push(<UserTextWithContext key={i} text={block.text} className={textClassName} />)
      else if (block.type === 'slash_command') elements.push(<SlashCommandChip key={i} block={block} />)
      else if (block.type === 'document') elements.push(<div key={i} className="py-0.5"><ContentBlockRenderer block={block} /></div>)
    }
  })
  flushImages()

  return elements
}

// ---------------------------------------------------------------------------
// CLI variant — monospace with "> " prefix
// ---------------------------------------------------------------------------

export const UserMessage = memo(function UserMessage({ id, content }: { id: string; content: ContentBlock[] }) {
  const hasRichContent = content.some((b) => b.type === 'slash_command' || b.type === 'image' || b.type === 'document')
  const plainText = hasRichContent ? '' : extractUserText(content)

  return (
    <div data-msg-id={id} data-msg-role="user" className="relative flex gap-2 py-1 -ml-3 pl-3 before:absolute before:left-0 before:top-[6px] before:bottom-[6px] before:w-0.5 before:bg-[hsl(var(--primary)/0.2)]">
      <span className="text-[hsl(var(--muted-foreground))] font-mono text-sm shrink-0 select-none leading-5" aria-hidden="true">{'>'}</span>
      <div className="min-w-0">
        {hasRichContent ? (
          <div className="text-sm font-mono text-[hsl(var(--foreground))] break-words min-w-0 leading-5">
            {renderUserContentBlocks(content)}
          </div>
        ) : (
          <>
            {plainText && (
              <div className="text-sm font-mono text-[hsl(var(--foreground))] break-words min-w-0 leading-5">
                <UserTextWithContext text={plainText} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
})

// ---------------------------------------------------------------------------
// Chat variant — right-aligned bubble
// ---------------------------------------------------------------------------

const CHAT_LINK_CLASS = '[&_a]:text-[hsl(var(--primary))] [&_a]:underline [&_a]:decoration-[hsl(var(--primary)/0.4)]'

// ---------------------------------------------------------------------------
// Tool-result user message — engine-emitted machinery, NOT real user input.
//
// The Anthropic protocol delivers tool results via user-role messages, but
// they are part of the assistant's tool flow — not something the user typed.
// They must render inline, left-aligned, with no chat-bubble wrapper and no
// `>` prefix.  Each block (ToolResultBlock + provenance-stamped media like
// browser_screenshot's BrowserScreenshotCard) goes through ContentBlockRenderer
// directly, mirroring the assistant's container styling for visual continuity.
// ---------------------------------------------------------------------------

export const ToolResultUserMessage = memo(function ToolResultUserMessage({
  id,
  content,
  sessionId,
}: {
  id: string
  content: ContentBlock[]
  sessionId?: string
}) {
  return (
    <div data-msg-id={id} data-msg-role="user-tool-result" className="py-0.5 break-words min-w-0">
      {content.map((block, i) => (
        <ContentBlockRenderer key={i} block={block} sessionId={sessionId} />
      ))}
    </div>
  )
})

export const ChatBubbleUserMessage = memo(function ChatBubbleUserMessage({ id, content }: { id: string; content: ContentBlock[] }) {
  const hasRichContent = content.some((b) => b.type === 'slash_command' || b.type === 'image' || b.type === 'document')
  const plainText = hasRichContent ? '' : extractUserText(content)

  return (
    <div data-msg-id={id} data-msg-role="user" className="flex justify-end py-1.5">
      <div className="max-w-[80%] px-4 py-2.5 rounded-2xl bg-[hsl(var(--foreground)/0.06)] dark:bg-white/10 text-[hsl(var(--foreground))]">
        {hasRichContent ? (
          <div className="text-sm break-words min-w-0 leading-relaxed">
            {renderUserContentBlocks(content, CHAT_LINK_CLASS)}
          </div>
        ) : (
          <>
            {plainText && (
              <div className="text-sm break-words min-w-0 leading-relaxed">
                <UserTextWithContext text={plainText} className={CHAT_LINK_CLASS} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
})
