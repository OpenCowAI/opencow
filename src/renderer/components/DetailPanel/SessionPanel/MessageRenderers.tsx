// SPDX-License-Identifier: Apache-2.0

/**
 * MessageRenderers — User message components for both CLI and chat variants.
 *
 * Extracted from SessionMessageList.tsx for single-responsibility:
 * these components handle pure rendering of user messages with no
 * scroll, virtualization, or data pipeline concerns.
 */

import { memo, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { LinkifiedText } from '@/components/ui/LinkifiedText'
import { ContentBlockRenderer } from './ContentBlockRenderer'
import { useToolLifecycleMap, type ToolLifecycleMap } from './ToolLifecycleContext'
import { shouldRenderToolResultBlock } from './ToolResultBlockView'
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
// User message — right-aligned chat bubble.  (The legacy CLI "> " prefix
// variant was retired — every consumer renders the same chat-bubble
// chip now, so the session transcript and the live Chat share one
// user-message look.)
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
  const toolLifecycleMap = useToolLifecycleMap()
  if (!hasVisibleToolResultUserMessageContent(content, toolLifecycleMap)) return null

  return (
    <div data-msg-id={id} data-msg-role="user-tool-result" className="py-0.5 break-words min-w-0">
      {content.map((block, i) => (
        <ContentBlockRenderer key={i} block={block} sessionId={sessionId} />
      ))}
    </div>
  )
})

/**
 * Wraps user message content with a 3-line clamp + "Show more / less"
 * toggle.  Long prompts (multi-paragraph instructions, pasted context)
 * are otherwise visually dominant in the transcript; clamping by default
 * keeps the message list scannable.
 *
 * Detection model: measure the content's `scrollHeight` against its
 * `clientHeight` *while line-clamp is active*.  When `scrollHeight`
 * overflows, the toggle is revealed.  We measure once on mount AND
 * track resize (container width shifts can change wrap counts), but
 * skip measurement while expanded — otherwise the unclamped element's
 * `scrollHeight === clientHeight` would wipe the toggle out.
 */
function CollapsibleUserText({ children }: { children: ReactNode }): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const [isExpanded, setIsExpanded] = useState(false)
  const [showToggle, setShowToggle] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (isExpanded) return
    const el = ref.current
    if (!el) return
    const measure = (): void => {
      // +1 to absorb sub-pixel rounding — the line-clamp utility uses
      // `display: -webkit-box` with a line count, so scrollHeight is
      // the natural height and clientHeight is the clamped height.
      setShowToggle(el.scrollHeight > el.clientHeight + 1)
    }
    measure()
    // Guard for environments without ResizeObserver (jsdom in tests).
    // Production browsers all have it; we degrade gracefully to a
    // single mount-time measurement when absent.
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [isExpanded])

  return (
    <>
      <div
        ref={ref}
        className={cn(
          'text-sm break-words min-w-0 leading-relaxed',
          !isExpanded && 'line-clamp-3',
        )}
      >
        {children}
      </div>
      {showToggle && (
        <button
          type="button"
          onClick={() => setIsExpanded((v) => !v)}
          aria-expanded={isExpanded}
          className="mt-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:underline transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded-sm"
        >
          {isExpanded ? t('userMessageCollapse.showLess') : t('userMessageCollapse.showMore')}
        </button>
      )}
    </>
  )
}

export const ChatBubbleUserMessage = memo(function ChatBubbleUserMessage({ id, content }: { id: string; content: ContentBlock[] }) {
  const hasRichContent = content.some((b) => b.type === 'slash_command' || b.type === 'image' || b.type === 'document')
  const plainText = hasRichContent ? '' : extractUserText(content)

  return (
    <div data-msg-id={id} data-msg-role="user" className="flex justify-end py-1.5">
      <div className="max-w-[80%] px-4 py-2.5 rounded-2xl bg-[hsl(var(--foreground)/0.06)] dark:bg-white/10 text-[hsl(var(--foreground))]">
        {hasRichContent ? (
          <CollapsibleUserText>
            {renderUserContentBlocks(content, CHAT_LINK_CLASS)}
          </CollapsibleUserText>
        ) : (
          <>
            {plainText && (
              <CollapsibleUserText>
                <UserTextWithContext text={plainText} className={CHAT_LINK_CLASS} />
              </CollapsibleUserText>
            )}
          </>
        )}
      </div>
    </div>
  )
})

/**
 * Engine-emitted user tool-result messages should only reserve space when at
 * least one block actually renders visible UI.
 */
export function hasVisibleToolResultUserMessageContent(
  content: readonly ContentBlock[],
  toolLifecycleMap: ToolLifecycleMap,
): boolean {
  for (const block of content) {
    if (block.type === 'image' && block.toolUseId) return true
    if (block.type === 'tool_result') {
      const toolName = toolLifecycleMap.get(block.toolUseId)?.name
      if (shouldRenderToolResultBlock(block, toolName)) return true
    }
  }
  return false
}
