// SPDX-License-Identifier: Apache-2.0

/**
 * ToolResultBlockView — renders tool result content blocks.
 *
 * ## Rendering paths (in priority order)
 *
 * 1. **Widget suppression**: If the tool is a Widget with `suppressResult: true`,
 *    the result is hidden entirely (the Widget handles result display).
 *    Determined declaratively via WidgetToolRegistry.shouldSuppressResult().
 *
 * 2. **Result Card**: If the tool has a registered rich-card renderer in
 *    RESULT_CARD_REGISTRY, parse the raw JSON and render the typed card.
 *    Falls through to raw text on parse failure.
 *
 * 3. **Raw text**: Default fallback for all other tools — shows the raw text
 *    content with collapse/expand for long output.
 *
 * Tool name resolution works via ToolLifecycleContext:
 *   ToolResultBlock.toolUseId → ToolLifecycleMap → { name } → routing
 */

import { memo, useState } from 'react'
import type { ToolResultBlock } from '@shared/types'
import { NativeCapabilityTools } from '@shared/nativeCapabilityToolNames'
import { useToolLifecycle } from './ToolLifecycleContext'
import { shouldSuppressResult } from './WidgetToolRegistry'
import {
  IssueResultCard,
  IssueListResultCard,
  ProjectResultCard,
  ProjectListResultCard,
  parseIssueData,
  parseIssueListData,
  parseProjectData,
  parseProjectListData,
  BrowserNavigateCard,
  BrowserActionStatusCard,
  BrowserExtractCard,
  BrowserSnapshotCard,
  BrowserScreenshotResultCard,
  parseBrowserNavigate,
  parseBrowserAction,
  parseBrowserExtract,
  parseBrowserSnapshot,
  parseBrowserScreenshot,
} from './ResultCards'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ToolResultBlockViewProps {
  block: ToolResultBlock
}

// ─── Result Card Registry ───────────────────────────────────────────────────

/**
 * Render function: parses raw tool_result content → rich card JSX,
 * or null if parsing fails (caller falls through to raw text).
 */
type ResultCardRenderer = (content: string) => React.JSX.Element | null

/**
 * Create a type-safe renderer from a parser + card component pair.
 *
 * The generic parameter `T` ensures the parser output type matches
 * the Component's `data` prop — type mismatch is a compile error.
 */
function createResultCardRenderer<T>(
  parse: (raw: string) => T,
  Card: React.ComponentType<{ data: T }>,
): ResultCardRenderer {
  return (content) => {
    try {
      const data = parse(content)
      return <Card data={data} />
    } catch {
      return null
    }
  }
}

/**
 * Maps tool names to rich-card renderers for result-dependent tools.
 *
 * Unlike Widget Tools (which render from tool_use input), these tools
 * have their primary data in the tool_result block — so the card is
 * rendered here in ToolResultBlockView where the data is a direct prop.
 */
const RESULT_CARD_REGISTRY = new Map<string, ResultCardRenderer>([
  // ── Issue tools ───────────────────────────────────────────────────────────
  [NativeCapabilityTools.ISSUE_GET,    createResultCardRenderer(parseIssueData, IssueResultCard)],
  [NativeCapabilityTools.ISSUE_CREATE, createResultCardRenderer(parseIssueData, IssueResultCard)],
  [NativeCapabilityTools.ISSUE_UPDATE, createResultCardRenderer(parseIssueData, IssueResultCard)],
  [NativeCapabilityTools.ISSUE_LIST,   createResultCardRenderer(parseIssueListData, IssueListResultCard)],

  // ── Project tools ─────────────────────────────────────────────────────────
  [NativeCapabilityTools.PROJECT_GET,  createResultCardRenderer(parseProjectData, ProjectResultCard)],
  [NativeCapabilityTools.PROJECT_LIST, createResultCardRenderer(parseProjectListData, ProjectListResultCard)],

  // ── Browser tools ───────────────────────────────────────────────────────
  [NativeCapabilityTools.BROWSER_NAVIGATE,  createResultCardRenderer(parseBrowserNavigate, BrowserNavigateCard)],
  [NativeCapabilityTools.BROWSER_CLICK,     createResultCardRenderer(parseBrowserAction, BrowserActionStatusCard)],
  [NativeCapabilityTools.BROWSER_TYPE,      createResultCardRenderer(parseBrowserAction, BrowserActionStatusCard)],
  [NativeCapabilityTools.BROWSER_SCROLL,    createResultCardRenderer(parseBrowserAction, BrowserActionStatusCard)],
  [NativeCapabilityTools.BROWSER_WAIT,      createResultCardRenderer(parseBrowserAction, BrowserActionStatusCard)],
  [NativeCapabilityTools.BROWSER_EXTRACT,   createResultCardRenderer(parseBrowserExtract, BrowserExtractCard)],
  [NativeCapabilityTools.BROWSER_SCREENSHOT, createResultCardRenderer(parseBrowserScreenshot, BrowserScreenshotResultCard)],
  [NativeCapabilityTools.BROWSER_SNAPSHOT,  createResultCardRenderer(parseBrowserSnapshot, BrowserSnapshotCard)],
  [NativeCapabilityTools.BROWSER_REF_CLICK, createResultCardRenderer(parseBrowserSnapshot, BrowserSnapshotCard)],
  [NativeCapabilityTools.BROWSER_REF_TYPE,  createResultCardRenderer(parseBrowserSnapshot, BrowserSnapshotCard)],
])

// ─── Constants ──────────────────────────────────────────────────────────────

const COLLAPSE_THRESHOLD = 20

// ─── Component ──────────────────────────────────────────────────────────────

export const ToolResultBlockView = memo(function ToolResultBlockView({ block }: ToolResultBlockViewProps): React.JSX.Element {
  // Resolve originating tool lifecycle via Context (O(1) Map lookup)
  const toolInfo = useToolLifecycle(block.toolUseId)

  // Path 1: Widget Tools with suppressResult=true — their result is rendered by the Widget.
  if (toolInfo && shouldSuppressResult(toolInfo.name)) return <></>

  // Path 2: Result Card — rich card for tools whose data lives in tool_result.
  if (toolInfo && block.content && !block.isError) {
    const renderer = RESULT_CARD_REGISTRY.get(toolInfo.name)
    if (renderer) {
      const card = renderer(block.content)
      if (card) return card
      // Parse failed → fall through to raw text
    }
  }

  // Path 3: Raw text fallback
  return <RawToolResult block={block} />
})

// ─── Raw fallback (extracted for clarity, logic identical to original) ───────

function RawToolResult({ block }: { block: ToolResultBlock }): React.JSX.Element {
  const lines = block.content.split('\n')
  const isLong = lines.length > COLLAPSE_THRESHOLD
  const [expanded, setExpanded] = useState(!isLong)

  const displayContent = expanded ? block.content : lines.slice(0, COLLAPSE_THRESHOLD).join('\n')

  if (!block.content) return <></>

  return (
    <div
      className={`rounded text-xs ${
        block.isError
          ? 'border-l-2 border-red-500 pl-2'
          : 'pl-2'
      }`}
    >
      <pre className="whitespace-pre-wrap break-words font-mono text-[hsl(var(--muted-foreground))] overflow-x-auto leading-normal">
        {displayContent}
      </pre>
      {isLong && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="mt-1 text-xs text-[hsl(var(--primary))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded-sm px-0.5"
          aria-label={`Show all ${lines.length} lines`}
        >
          {`Show more (${lines.length} lines)`}
        </button>
      )}
      {isLong && expanded && (
        <button
          onClick={() => setExpanded(false)}
          className="mt-1 text-xs text-[hsl(var(--primary))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded-sm px-0.5"
          aria-label="Collapse output"
        >
          Show less
        </button>
      )}
    </div>
  )
}
