// SPDX-License-Identifier: Apache-2.0

/**
 * WidgetToolRegistry — maps tool names to their first-class card components.
 *
 * Widget Tools render ONLY their card (no tool row pill). The card is the sole
 * visual representation of the tool call, responsible for showing input, status,
 * and interaction affordances.
 *
 * ## Registration model
 *
 * Each entry is a `WidgetRegistration` with:
 *   - `component`: The React component satisfying WidgetToolProps.
 *   - `suppressResult`: Whether the tool_result block should be hidden
 *     (true when the Widget itself renders the result, e.g. Task).
 *
 * ## Adding a new Widget Tool
 *
 *   1. Create the Widget adapter component (satisfying WidgetToolProps)
 *   2. Register it here with { component, suppressResult }
 *   — ContentBlockRenderer routes automatically, zero code change needed.
 *   — ToolResultBlockView suppresses automatically for suppressResult=true.
 */

import type { ToolUseBlock } from '@shared/types'

// ─── Props contract ──────────────────────────────────────────────────────────

/** Props contract that all Widget Tool adapter components must satisfy. */
export interface WidgetToolProps {
  block: ToolUseBlock
  isExecuting: boolean
  /**
   * Whether the parent message is still streaming content from the model.
   *
   * Useful for widgets (e.g. GenHtmlWidget) that need to distinguish
   * "tool input is still being generated" from "tool completed with no content"
   * — both have isExecuting=false, but the former should show a loading
   * skeleton while the latter is an error state.
   */
  isMessageStreaming?: boolean
}

// ─── Registration types ─────────────────────────────────────────────────────

type WidgetToolComponent = React.ComponentType<WidgetToolProps>

interface WidgetRegistration {
  /** The widget component to render for this tool. */
  component: WidgetToolComponent
  /**
   * Whether to suppress the corresponding tool_result block rendering.
   *
   * - `true`: Widget handles result display (e.g. Task widget).
   *   The tool_result block will be hidden by ToolResultBlockView.
   * - `false`: tool_result renders normally alongside the Widget.
   *   Used by widgets that only enhance the tool_use display (TodoWrite, etc.).
   */
  suppressResult: boolean
}

// ─── Imports ────────────────────────────────────────────────────────────────

import { TaskExecutionView } from './TaskWidgets'
import { TodoWriteWidget } from './TodoWriteWidget'
import { AskUserQuestionWidget } from './AskUserQuestionWidget'
import { GenHtmlWidget } from './GenHtmlWidget'
import { ExitPlanModeWidget } from './ExitPlanModeWidget'
import { EvoseToolWidget } from './EvoseToolWidget'
import { NativeCapabilityTools } from '@shared/nativeCapabilityToolNames'

// ─── Registry ────────────────────────────────────────────────────────────────

const WIDGET_REGISTRY = new Map<string, WidgetRegistration>([
  // ── Native SDK tools ──────────────────────────────────────────────────────
  ['Agent',           { component: TaskExecutionView,    suppressResult: true  }],
  ['Task',            { component: TaskExecutionView,    suppressResult: true  }],
  // TodoWrite / AskUserQuestion / ExitPlanMode return model-facing nudge
  // strings ("Todos have been modified successfully…" etc.) that carry zero
  // human value — the Widget already renders the actually-useful structured
  // payload (todo list, question, plan). Suppressing the raw text removes
  // duplicate noise below the pill and unifies Claude / OpenAI rendering
  // (Claude historically had no persisted tool_result so the noise was
  // invisible; after the user.tool_result projector landed, both providers
  // now persist these results and would otherwise display the same nudge).
  ['TodoWrite',       { component: TodoWriteWidget,      suppressResult: true  }],
  ['AskUserQuestion', { component: AskUserQuestionWidget, suppressResult: true  }],
  ['ExitPlanMode',    { component: ExitPlanModeWidget,   suppressResult: true  }],

  // ── NativeCapability tools ────────────────────────────────────────────────
  [NativeCapabilityTools.ASK_USER_QUESTION, { component: AskUserQuestionWidget, suppressResult: true  }],
  [NativeCapabilityTools.GEN_HTML,          { component: GenHtmlWidget,         suppressResult: false }],

  // ── Evose tools ─────────────────────────────────────────────────────────
  // Single card replaces both the pill row and progress card — no dual-element confusion.
  // suppressResult=true: EvoseProgressCard already shows the full streaming output.
  [NativeCapabilityTools.EVOSE_RUN_AGENT,    { component: EvoseToolWidget, suppressResult: true }],
  [NativeCapabilityTools.EVOSE_RUN_WORKFLOW,  { component: EvoseToolWidget, suppressResult: true }],

  // Note: Issue & Project tools render rich cards via ToolResultBlockView's
  // RESULT_CARD_REGISTRY (data lives in tool_result, not tool_use input).
])

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolve a Widget Tool component by tool name.
 * Returns null for standard tools that should use ToolUseBlockView.
 */
export function resolveWidgetTool(toolName: string): WidgetToolComponent | null {
  return WIDGET_REGISTRY.get(toolName)?.component ?? null
}

/**
 * Fast membership check: is this tool name registered as a Widget Tool?
 * Used by ToolBatchCollapsible to exclude Widget Tools from collapsed batches.
 */
export const WIDGET_TOOL_NAMES: ReadonlySet<string> = new Set(WIDGET_REGISTRY.keys())

/**
 * Check if a tool's result should be suppressed in ToolResultBlockView.
 * Returns true when the Widget handles result rendering itself.
 *
 * Declarative — the suppression decision lives in the registry alongside
 * the component, not hardcoded in ToolResultBlockView.
 */
export function shouldSuppressResult(toolName: string): boolean {
  return WIDGET_REGISTRY.get(toolName)?.suppressResult === true
}
