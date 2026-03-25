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
import type { ContentBlock } from '@shared/types'
import { getSlashDisplayLabel } from '@shared/slashDisplay'

interface ContentBlockRendererProps {
  block: ContentBlock
  sessionId?: string
  isLastTextBlock?: boolean
  isStreaming?: boolean
  isMessageStreaming?: boolean
  activeToolUseId?: string | null
}

export const ContentBlockRenderer = memo(function ContentBlockRenderer({
  block,
  sessionId,
  isLastTextBlock,
  isStreaming,
  isMessageStreaming,
  activeToolUseId
}: ContentBlockRendererProps): React.JSX.Element {
  // Full lifecycle map for context-aware image rendering (screenshot detection).
  // Hook called unconditionally at top level per Rules of Hooks.
  const toolMap = useToolLifecycleMap()

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
    case 'image': {
      // Context-aware rendering: ImageBlocks extracted from tool_results carry
      // toolUseId as provenance. If it came from browser_screenshot, render the
      // browser-chrome preview card instead of the default thumbnail.
      if (block.toolUseId) {
        const toolInfo = toolMap.get(block.toolUseId)
        if (toolInfo?.name === NativeCapabilityTools.BROWSER_SCREENSHOT) {
          return <BrowserScreenshotCard imageData={block.data} mediaType={block.mediaType} />
        }
      }
      return <ImageBlockView block={block} />
    }
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
