// SPDX-License-Identifier: Apache-2.0

/**
 * GenHtmlWidget — Widget Tool adapter for gen_html.
 *
 * Bridges the WidgetToolProps interface to HtmlFileCard.
 * Extracts title + content from the block's input, derives the lifecycle status,
 * and delegates rendering entirely to HtmlFileCard.
 *
 * The onClick handler opens the ContentViewer dialog with the generated HTML.
 */

import { useContentViewerContext } from './ContentViewerContext'
import { HtmlFileCard } from './PreviewCards/HtmlFileCard'
import type { HtmlCardStatus } from './PreviewCards/HtmlFileCard'
import type { WidgetToolProps } from './WidgetToolRegistry'
import { parseGenHtmlInput } from '@shared/genHtmlInput'

export function resolveGenHtmlContent(input: Record<string, unknown>): string | null {
  return parseGenHtmlInput(input).content
}

export function GenHtmlWidget({ block, isExecuting, isMessageStreaming }: WidgetToolProps): React.JSX.Element {
  const { showContentViewer } = useContentViewerContext()

  const { title, content } = parseGenHtmlInput(block.input)

  // Status priority:
  // 1. Tool is executing (MCP call in flight)        → generating
  // 2. Message still streaming (input being built up) → generating
  //    (Without this, the card shows "error" during the entire input
  //     streaming phase because isExecuting=false and content is null.)
  // 3. Content available                              → generated
  // 4. Otherwise                                      → error
  const status: HtmlCardStatus = (isExecuting || isMessageStreaming)
    ? 'generating'
    : content
      ? 'generated'
      : 'error'

  const handleClick = (): void => {
    if (content) {
      showContentViewer({
        content,
        fileName: `${title}.html`,
        filePath: '',
        language: 'html',
      })
    }
  }

  return (
    <HtmlFileCard
      title={title}
      content={content}
      status={status}
      onClick={handleClick}
    />
  )
}
