// SPDX-License-Identifier: Apache-2.0

/**
 * Tool metadata registry — icons, display names, and target extraction.
 *
 * ## Design
 *
 * OpenCow's built-in MCP tool names follow a structured naming convention:
 *
 *   mcp__{server-name}__{category}_{action}
 *   ────────────────────────────────────────
 *   mcp__opencow-capabilities__browser_navigate
 *
 * The `mcp__…__` prefix is a **transport-layer artifact** added by the
 * Anthropic SDK — it carries no business semantics.  This module normalises
 * raw tool names and derives display metadata algorithmically where possible,
 * so that adding a new Capability tool requires zero changes here.
 *
 * ## Rules
 *
 * 1. `parseMcpToolName()` strips the protocol prefix and returns a structured
 *    `{ server, category, action, toolName }` value.
 * 2. `getToolDisplayName()` derives a human-friendly label from `action`
 *    (title-cased).  No hardcoded mapping needed.  Exported for lightweight
 *    callers that only need the name (e.g. ToolBatchCollapsible).
 * 3. `getToolMeta()` is the **primary entry point** for components: it parses
 *    the raw name once and returns `{ icon, displayName, target }` together.
 *    Prefer this over calling getToolDisplayName + resolving icon/target
 *    separately — it avoids redundant parsing and keeps the call site clean.
 *
 * High-cohesion: all tool-presentation logic lives here.
 * Low-coupling:  components import helpers, not raw data tables.
 */

import {
  Eye,
  FileText,
  PenLine,
  Terminal,
  FolderSearch,
  Search,
  ListChecks,
  Globe,
  Wrench,
  CheckSquare,
  ClipboardCheck,
  HelpCircle,
  BookOpen,
  Zap,
  GitBranch,
  Map as MapIcon,
  // Browser tool icons
  Navigation,
  MousePointerClick,
  Keyboard,
  ScanText,
  ScanSearch,
  Camera,
  ScrollText,
  Timer,
  // Issue & Project tool icons
  CircleDot,
  PlusCircle,
  FolderOpen,
  MessageSquare,
  // Schedule tool icons
  Calendar,
  Clock,
  Pause,
  Play,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { safeSlice } from '@shared/unicode'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum characters shown for URL/query targets in the UI. */
const MAX_URL_TARGET = 60
/** Maximum characters shown for bash command targets in the UI. */
const MAX_COMMAND_TARGET = 80
/** Maximum characters shown for text/selector/query targets in the UI. */
const MAX_TEXT_TARGET = 60
/** Maximum characters shown for typed text previews in the UI. */
const MAX_TYPE_PREVIEW = 40

// ─── MCP name parsing ─────────────────────────────────────────────────────────

interface ParsedMcpName {
  /** MCP server name, e.g. 'opencow-capabilities' */
  server: string
  /** Tool group / Capability category, e.g. 'browser' */
  category: string
  /** Action within the category, e.g. 'navigate' (may be multi-word: 'take_screenshot') */
  action: string
  /** Normalised tool name without prefix, e.g. 'browser_navigate' */
  toolName: string
}

/**
 * Parses an MCP-prefixed tool name into its structural parts.
 *
 * Format:  `mcp__{server}__{tool_name}`
 * Example: `mcp__opencow-capabilities__browser_navigate`
 *            → { server: 'opencow-capabilities', category: 'browser',
 *                action: 'navigate', toolName: 'browser_navigate' }
 *
 * Returns `null` for native (non-MCP) tool names like 'Read', 'Bash'.
 */
function parseMcpToolName(rawName: string): ParsedMcpName | null {
  // Split on __ yields exactly ['mcp', server, toolName] for valid MCP names.
  const parts = rawName.split('__')
  if (parts.length !== 3 || parts[0] !== 'mcp') return null

  const server = parts[1]
  const toolName = parts[2]

  // Convention: toolName = {category}_{action...}
  const separatorIdx = toolName.indexOf('_')
  if (separatorIdx === -1) {
    return { server, category: toolName, action: '', toolName }
  }

  const category = toolName.slice(0, separatorIdx)
  const action = toolName.slice(separatorIdx + 1)
  return { server, category, action, toolName }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function toTitleCase(snake: string): string {
  return snake
    .split('_')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
    .join(' ')
    .trim()
}

/**
 * Extracts the hostname from a URL string for compact display.
 * Falls back to a truncated raw URL if parsing fails.
 */
function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return safeSlice(url, 0, MAX_URL_TARGET)
  }
}

// ─── Display names ────────────────────────────────────────────────────────────

/**
 * Returns a human-friendly display name for any tool name.
 *
 * - Native tools ('Read', 'Bash', …) — already user-friendly, returned as-is.
 * - MCP tools — action part is title-cased algorithmically.
 *   e.g. `mcp__opencow-capabilities__browser_navigate` → `'Navigate'`
 *        `mcp__opencow-capabilities__browser_take_screenshot` → `'Take Screenshot'`
 *
 * Zero hardcoded mappings: new Capability tools get correct names automatically.
 */
export function getToolDisplayName(rawName: string): string {
  const parsed = parseMcpToolName(rawName)
  if (!parsed) return rawName

  // Prefer the action; fall back to the full tool name if no action present.
  return parsed.action ? toTitleCase(parsed.action) : toTitleCase(parsed.toolName)
}

// ─── Icon registry ────────────────────────────────────────────────────────────

/**
 * Icon registry keyed by **normalised tool name** (no MCP prefix).
 *
 * Native tools use their SDK name directly (PascalCase).
 * MCP tools use the `{category}_{action}` portion only (snake_case).
 * These two namespaces cannot collide in practice.
 *
 * This decouples the registry from transport-layer naming.
 */
const TOOL_ICONS: Readonly<Record<string, LucideIcon>> = {
  // ── Native tools ──────────────────────────────────────────────────────────
  Read: Eye,
  Write: FileText,
  Edit: PenLine,
  Bash: Terminal,
  Glob: FolderSearch,
  Grep: Search,
  Task: ListChecks,
  WebSearch: Globe,
  WebFetch: Globe,
  TodoWrite: CheckSquare,
  ExitPlanMode: ClipboardCheck,
  EnterPlanMode: MapIcon,
  AskUserQuestion: HelpCircle,
  NotebookEdit: BookOpen,
  Skill: Zap,
  EnterWorktree: GitBranch,

  // ── Browser Capability tools (keyed by normalised name, no mcp__ prefix) ──
  browser_navigate: Navigation,
  browser_click: MousePointerClick,
  browser_type: Keyboard,
  browser_extract: ScanText,
  browser_screenshot: Camera,
  browser_scroll: ScrollText,
  browser_wait: Timer,
  browser_snapshot: ScanSearch,
  browser_ref_click: MousePointerClick,
  browser_ref_type: Keyboard,

  // ── Issue Capability tools (keyed by normalised name) ──
  list_issues: CircleDot,
  get_issue: CircleDot,
  create_issue: PlusCircle,
  update_issue: PenLine,
  search_remote_issues: Globe,
  get_remote_issue: Globe,
  comment_remote_issue: MessageSquare,

  // ── Project Capability tools ──
  list_projects: FolderOpen,
  get_project: FolderOpen,

  // ── Schedule Capability tools ──
  list_schedules:    Calendar,
  get_schedule:      Calendar,
  create_schedule:   PlusCircle,
  update_schedule:   PenLine,
  pause_schedule:    Pause,
  resume_schedule:   Play,
  preview_next_runs: Clock,

  // ── HTML Capability tools ──
  gen_html: Globe,

  // ── Evose Gateway tools ──
  evose_run_agent: Zap,
  evose_run_workflow: Zap,
  evose_list_apps: ListChecks,
}

/**
 * Per-category fallback icons for MCP tools not individually registered above.
 * New tools in a known Capability category automatically inherit this icon.
 */
const CATEGORY_ICONS: Readonly<Record<string, LucideIcon>> = {
  browser: Globe,
  html: Globe,
  evose: Zap,
}

// ─── Unified metadata accessor ────────────────────────────────────────────────

export interface ToolMeta {
  /** Lucide icon component for the tool. */
  icon: LucideIcon
  /** Human-friendly tool name (e.g. 'Navigate', 'Read'). */
  displayName: string
  /** Compact target string derived from tool inputs (e.g. hostname, basename). */
  target: string
}

/**
 * Returns all presentation metadata for a tool in a single call.
 *
 * This is the primary public API for components that need more than just the
 * display name.  It parses the raw MCP name exactly once and returns the
 * complete set of presentation values — icon, display name, and target.
 *
 * @param rawName  The raw tool name from the Claude API (may be MCP-prefixed).
 * @param input    The tool's input parameters object.
 */
export function getToolMeta(rawName: string, input: Record<string, unknown>): ToolMeta {
  const parsed = parseMcpToolName(rawName)

  const displayName = parsed
    ? parsed.action ? toTitleCase(parsed.action) : toTitleCase(parsed.toolName)
    : rawName

  let icon: LucideIcon
  if (rawName in TOOL_ICONS) {
    icon = TOOL_ICONS[rawName]
  } else if (parsed) {
    icon = TOOL_ICONS[parsed.toolName] ?? CATEGORY_ICONS[parsed.category] ?? Wrench
  } else {
    icon = Wrench
  }

  // Normalise name once for target extraction switch.
  const normName = parsed?.toolName ?? rawName
  const target = getToolTargetByNormName(normName, input)

  return { icon, displayName, target }
}

/**
 * Internal: target extraction by already-normalised tool name.
 * Extracted so `getToolMeta` can reuse it without re-parsing.
 */
function getToolTargetByNormName(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit': {
      const filePath = input.file_path as string | undefined
      if (!filePath) return ''
      const parts = filePath.split('/')
      return parts[parts.length - 1] || filePath
    }
    case 'Bash': {
      const command = input.command as string | undefined
      if (!command) return ''
      return safeSlice(command.split('\n')[0], 0, MAX_COMMAND_TARGET)
    }
    case 'Glob':
    case 'Grep':
      return (input.pattern as string | undefined) ?? ''
    case 'Task':
      return (input.description as string | undefined) ?? ''
    case 'TodoWrite': {
      const todos = input.todos as unknown[] | undefined
      return todos ? `${todos.length} items` : ''
    }
    case 'WebSearch':
      return (input.query as string | undefined) ? safeSlice(input.query as string, 0, MAX_TEXT_TARGET) : ''
    case 'WebFetch': {
      const url = input.url as string | undefined
      return url ? hostnameFromUrl(url) : ''
    }
    case 'Skill':
      return (input.skill as string | undefined) ?? ''
    case 'NotebookEdit': {
      const nbPath = input.notebook_path as string | undefined
      if (!nbPath) return ''
      const parts = nbPath.split('/')
      return parts[parts.length - 1] || nbPath
    }
    case 'AskUserQuestion': {
      const qs = input.questions as Array<{ question?: string }> | undefined
      if (!qs || qs.length === 0) return ''
      return qs[0].question ? safeSlice(qs[0].question, 0, MAX_TEXT_TARGET) : ''
    }
    case 'browser_navigate': {
      const url = input.url as string | undefined
      return url ? hostnameFromUrl(url) : ''
    }
    case 'browser_click':
      return (input.selector as string | undefined) ? safeSlice(input.selector as string, 0, MAX_TEXT_TARGET) : ''
    case 'browser_type': {
      const text = input.text as string | undefined
      const selector = input.selector as string | undefined
      if (text) return `"${safeSlice(text, 0, MAX_TYPE_PREVIEW)}"`
      return selector ? safeSlice(selector, 0, MAX_TEXT_TARGET) : ''
    }
    case 'browser_extract': {
      const sel = input.selector as string | undefined
      return sel ? safeSlice(sel, 0, MAX_TEXT_TARGET) : 'full page'
    }
    case 'browser_screenshot':
      return ''
    case 'browser_scroll': {
      const dir = input.direction as string | undefined
      const amount = input.amount as number | undefined
      if (dir && amount !== undefined) return `${dir} ${amount}px`
      return dir ?? ''
    }
    case 'browser_wait':
      return (input.selector as string | undefined) ? safeSlice(input.selector as string, 0, MAX_TEXT_TARGET) : ''
    case 'browser_snapshot':
      return ''
    case 'browser_ref_click':
      return typeof input.ref === 'string' ? input.ref : ''
    case 'browser_ref_type': {
      const refTypeRef = input.ref as string | undefined
      const refTypeText = input.text as string | undefined
      if (refTypeRef && refTypeText) return `${refTypeRef} "${safeSlice(refTypeText, 0, MAX_TYPE_PREVIEW)}"`
      return refTypeRef ?? ''
    }
    case 'gen_html':
      return typeof input.title === 'string' ? input.title : ''

    // ── Evose Gateway tools ────────────────────────────────────────────
    case 'evose_run_agent':
    case 'evose_run_workflow':
      return typeof input.app_id === 'string' ? input.app_id : ''
    case 'evose_list_apps':
      return typeof input.type === 'string' ? input.type : ''

    // ── Issue tools ────────────────────────────────────────────────────
    case 'list_issues':
      return issueListTarget(input)
    case 'get_issue':
      return typeof input.id === 'string' ? input.id : ''
    case 'create_issue':
      return typeof input.title === 'string' ? safeSlice(input.title, 0, MAX_TEXT_TARGET) : ''
    case 'update_issue':
      return updateFieldsTarget(input, ['title', 'description', 'status', 'priority', 'labels', 'projectId', 'parentIssueId'])

    // ── Remote Issue tools ──────────────────────────────────────────────
    case 'search_remote_issues':
      return typeof input.providerId === 'string' ? input.providerId : ''
    case 'get_remote_issue':
      return typeof input.number === 'number' ? `#${input.number}` : ''
    case 'comment_remote_issue':
      return typeof input.number === 'number' ? `#${input.number}` : ''

    // ── Project tools ──────────────────────────────────────────────────
    case 'list_projects':
      return ''
    case 'get_project':
      return typeof input.id === 'string' ? input.id : ''

    // ── Schedule tools ──────────────────────────────────────────────────
    case 'list_schedules':
      return scheduleListTarget(input)
    case 'get_schedule':
      return typeof input.id === 'string' ? input.id : ''
    case 'create_schedule':
      return typeof input.name === 'string' ? safeSlice(input.name, 0, MAX_TEXT_TARGET) : ''
    case 'update_schedule':
      return updateFieldsTarget(input, ['name', 'description', 'trigger', 'action', 'priority', 'projectId'])
    case 'pause_schedule':
    case 'resume_schedule':
      return typeof input.id === 'string' ? input.id : ''
    case 'preview_next_runs':
      return typeof input.id === 'string' ? input.id : ''

    default:
      return ''
  }
}

// ─── Target helpers ──────────────────────────────────────────────────────────

/**
 * Compact filter summary for list_issues pill target.
 * E.g. "todo, in_progress · high" or "search: deploy bug".
 */
function issueListTarget(input: Record<string, unknown>): string {
  const parts: string[] = []
  const search = input.search as string | undefined
  if (search) return `"${safeSlice(search, 0, 30)}"`
  const statuses = input.statuses as string[] | undefined
  if (statuses?.length) parts.push(statuses.join(', '))
  const priorities = input.priorities as string[] | undefined
  if (priorities?.length) parts.push(priorities.join(', '))
  const labels = input.labels as string[] | undefined
  if (labels?.length) parts.push(labels.join(', '))
  return parts.join(' · ')
}

/**
 * Compact filter summary for list_schedules pill target.
 */
function scheduleListTarget(input: Record<string, unknown>): string {
  const search = input.search as string | undefined
  if (search) return `"${safeSlice(search, 0, 30)}"`
  const statuses = input.statuses as string[] | undefined
  if (statuses?.length) return statuses.join(', ')
  return ''
}

/**
 * Shows which fields are being updated for update_* tools.
 * E.g. "status, priority" — helps user see what changed at a glance.
 */
function updateFieldsTarget(input: Record<string, unknown>, knownFields: string[]): string {
  const changed = knownFields.filter((f) => input[f] !== undefined)
  return changed.length > 0 ? changed.join(', ') : ''
}
