// SPDX-License-Identifier: Apache-2.0

import { memo } from 'react'
import { MarkdownContent } from '../../ui/MarkdownContent'
import { ToolUseBlockView } from './ToolUseBlockView'
import { ToolResultBlockView } from './ToolResultBlockView'
import { ThinkingBlockView } from './ThinkingBlockView'
import { ImageBlockView } from './ImageBlockView'
import { DocumentBlockView } from './DocumentBlockView'
import { BrowserScreenshotCard } from './PreviewCards/BrowserScreenshotCard'
import { resolveWidgetTool } from './WidgetToolRegistry'
import { useToolLifecycleMap } from './ToolLifecycleContext'
import { NativeCapabilityTools } from '@shared/nativeCapabilityToolNames'
import type { ContentBlock, ImageBlock } from '@shared/types'
import { getSlashDisplayLabel } from '@shared/slashDisplay'

interface ContentBlockRendererProps {
  block: ContentBlock
  sessionId?: string
  isLastTextBlock?: boolean
  isStreaming?: boolean
  isMessageStreaming?: boolean
  activeToolUseId?: string | null
}

/**
 * Renders a single content block (text, image, tool_use, tool_result, etc.).
 *
 * Performance-critical: this component is instantiated per content block inside
 * Virtuoso's visible range.  A typical viewport has 25-50 instances.
 *
 * IMPORTANT — Context subscription isolation:
 * This component does NOT subscribe to ToolLifecycleContext directly.
 * Only `ImageBlockWithScreenshotDetection` (below) subscribes, because it's
 * the sole consumer that needs the tool lifecycle map (to detect browser
 * screenshots).  This prevents Context value changes from forcing re-renders
 * of ALL 25-50 ContentBlockRenderer instances — only the few image blocks
 * (typically 0-2) re-render on Context changes.
 */
export const ContentBlockRenderer = memo(function ContentBlockRenderer({
  block,
  sessionId,
  isLastTextBlock,
  isStreaming,
  isMessageStreaming,
  activeToolUseId
}: ContentBlockRendererProps): React.JSX.Element {
  switch (block.type) {
    case 'text':
      return (
        <div className="py-0.5 break-words min-w-0">
          <MarkdownContent content={block.text} isStreaming={isLastTextBlock && isStreaming} />
          {isLastTextBlock && isStreaming && (
            <span className="streaming-dots text-[hsl(var(--foreground))]" aria-hidden="true">
              <span className="streaming-dot" />
              <span className="streaming-dot" />
              <span className="streaming-dot" />
            </span>
          )}
        </div>
      )
    case 'image':
      // Context-aware rendering delegated to a dedicated component that
      // isolates the ToolLifecycleContext subscription.  See JSDoc above.
      return <ImageBlockWithScreenshotDetection block={block} />
    case 'document':
      return <DocumentBlockView block={block} />
    case 'tool_use': {
      // activeToolUseId is the single source of truth for "tool is executing".
      // Decoupled from isMessageStreaming: message-level streaming controls the
      // text cursor (streaming dots), while activeToolUseId controls tool execution
      // indicators (spinners). These are orthogonal concerns — MCP tools execute
      // AFTER message finalization (isMessageStreaming=false), so gating on
      // isMessageStreaming would permanently hide execution state for MCP tools.
      const isExecuting = activeToolUseId === block.id
      // Widget Tools render their own card — no tool row pill.
      // New Widget Tools only need a registry entry; zero changes here.
      const WidgetComponent = resolveWidgetTool(block.name)
      if (WidgetComponent) {
        return <WidgetComponent block={block} isExecuting={isExecuting} isMessageStreaming={isMessageStreaming} />
      }
      return (
        <ToolUseBlockView
          block={block}
          sessionId={sessionId}
          isExecuting={isExecuting}
        />
      )
    }
    case 'tool_result':
      return <ToolResultBlockView block={block} />
    case 'thinking':
      return <div className="py-0.5"><ThinkingBlockView block={block} /></div>
    case 'slash_command': {
      const label = getSlashDisplayLabel(block)
      return (
        <span className="slash-mention" role="img" aria-label={`Slash command: ${label}`}>
          /{label}
        </span>
      )
    }
    default:
      return <></>
  }
})

// ---------------------------------------------------------------------------
// ImageBlockWithScreenshotDetection — Context subscription isolation
//
// Only image blocks need the ToolLifecycleContext (to detect browser_screenshot
// tool provenance).  By isolating useContext to this dedicated component,
// Context value changes only trigger re-renders for image block instances
// (typically 0-2 on screen), not all 25-50 ContentBlockRenderer instances.
// ---------------------------------------------------------------------------

const ImageBlockWithScreenshotDetection = memo(function ImageBlockWithScreenshotDetection({
  block,
}: {
  block: ImageBlock
}): React.JSX.Element {
  const toolMap = useToolLifecycleMap()
  if (block.toolUseId) {
    const toolInfo = toolMap.get(block.toolUseId)
    if (toolInfo?.name === NativeCapabilityTools.BROWSER_SCREENSHOT) {
      return <BrowserScreenshotCard imageData={block.data} mediaType={block.mediaType} />
    }
  }
  return <ImageBlockView block={block} />
})
