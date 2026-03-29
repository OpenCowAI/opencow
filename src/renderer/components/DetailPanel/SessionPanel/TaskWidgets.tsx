// SPDX-License-Identifier: Apache-2.0

/**
 * TaskWidgets — Sub-agent lifecycle tracking and rendering.
 *
 * Replaces the old TaskAgentCard (which was a Widget appendage inside
 * ToolUseBlockView) with a first-class TaskExecutionView that owns the
 * full rendering of a Task tool call: lifecycle state, real-time progress,
 * summary, usage stats, and the sub-agent's result output.
 *
 * Data flow:
 *   buildTaskLifecycleMap(messages)      → TaskEventsScanResult { map, consumedTaskIds }
 *   resolveTaskFinalStates(map, …) → TaskEventsMap (with inferred terminal states)
 *   <TaskEventsProvider value={…}>  → React Context
 *   <TaskExecutionView block={…}>   → reads useTaskLifecycle(toolUseId)
 */

import { createContext, useContext, memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, XCircle, Loader2, PauseCircle, ChevronRight } from 'lucide-react'
import { cn } from '../../../lib/utils'
import type {
  ManagedSessionMessage,
  ManagedSessionState,
  SessionStopReason,
  SystemEvent,
  ToolUseBlock,
} from '@shared/types'

// ─── Types ───────────────────────────────────────────────────────────────────

/** Sub-agent lifecycle state, derived from presence/absence of system events. */
export type TaskAgentState = 'pending' | 'running' | 'completed' | 'failed' | 'stopped'

/** Aggregated lifecycle info for a single Task tool call. */
export interface TaskLifecycleInfo {
  state: TaskAgentState
  taskId?: string
  description?: string        // from TaskStartedEvent
  taskType?: string           // from TaskStartedEvent.taskType (SDK field)
  summary?: string            // from TaskNotificationEvent
  outputFile?: string         // from TaskNotificationEvent.outputFile (SDK field)
  durationMs?: number         // from usage.durationMs
  totalTokens?: number        // from usage.totalTokens
  toolUses?: number           // from usage.toolUses
  /**
   * The terminal status reported by SDK's task_notification event.
   * Stored as metadata only — does NOT directly drive `state`.
   * State transitions to terminal are driven by tool_result arrival
   * or session finalization (see resolveTaskFinalStates).
   */
  notifiedStatus?: 'completed' | 'failed' | 'stopped'
  /** Full sub-agent output text, captured from the corresponding tool_result block. */
  resultContent?: string
  /** Whether the tool_result was marked as an error. */
  resultIsError?: boolean
}

/** Context value: mapping toolUseId → TaskLifecycleInfo */
export type TaskEventsMap = Map<string, TaskLifecycleInfo>

/** Result of buildTaskLifecycleMap: the lifecycle map + set of consumed taskIds */
export interface TaskEventsScanResult {
  map: TaskEventsMap
  /** taskIds that were successfully linked to a toolUseId (consumed by TaskExecutionView) */
  consumedTaskIds: ReadonlySet<string>
}

// ─── Context ─────────────────────────────────────────────────────────────────

const TaskEventsContext = createContext<TaskEventsMap>(new Map())

export const TaskEventsProvider = TaskEventsContext.Provider

/** Look up lifecycle info for a Task tool call from context. */
export function useTaskLifecycle(toolUseId: string): TaskLifecycleInfo | undefined {
  return useContext(TaskEventsContext).get(toolUseId)
}

// ─── Pure utilities ──────────────────────────────────────────────────────────

/** Session states that indicate the SDK is still actively processing. */
const ACTIVE_SESSION_STATES: Set<ManagedSessionState> = new Set(['creating', 'streaming'])

/**
 * Scan session messages for Task tool lifecycle events.
 *
 * Two message-dependent passes are applied:
 *
 * 1. **System events** (`task_started` / `task_notification`).
 *    `task_started` transitions state to `'running'`.
 *    `task_notification` does NOT directly drive state — it stores metadata
 *    (summary, usage stats) and `notifiedStatus`.  This prevents premature
 *    "completed" display: the sub-agent finishing is not the same as the
 *    Task tool call finishing (the main agent still needs to receive the
 *    tool_result).  Exception: 'failed' / 'stopped' are set immediately
 *    since these error states likely won't produce a normal tool_result.
 *
 * 2. **Message ordering + tool_result collection**.
 *    `tool_result` arrival is the primary trigger for terminal state.
 *    When a `tool_result` matches a known Task entry, the state is set to
 *    `notifiedStatus` (if available) or inferred from `isError`.
 *    When a later turn exists, any unresolved Tasks from earlier turns
 *    are also upgraded to their terminal state.
 *
 * Returns the lifecycle map and a set of consumed `taskId`s.  The map may
 * still contain 'running' / 'pending' entries for the last turn's tasks —
 * use {@link resolveTaskFinalStates} to infer their terminal states from
 * the session lifecycle.
 *
 * **Dependency note**: This function depends ONLY on `messages`.  The
 * `consumedTaskIds` output is fully determined by message content, making it
 * safe to memoize independently of session lifecycle state.
 */
export function buildTaskLifecycleMap(
  messages: ManagedSessionMessage[],
): TaskEventsScanResult {
  const map = new Map<string, TaskLifecycleInfo>()
  // Secondary lookup: taskId → toolUseId (fallback when task_notification lacks toolUseId)
  const taskIdToToolUseId = new Map<string, string>()
  const consumedTaskIds = new Set<string>()

  // ── Pass 1: process system events ──────────────────────────────────────────

  for (const msg of messages) {
    if (msg.role !== 'system') continue
    const { event } = msg

    if (event.type === 'task_started' && event.toolUseId) {
      taskIdToToolUseId.set(event.taskId, event.toolUseId)
      consumedTaskIds.add(event.taskId)
      const existing = map.get(event.toolUseId)
      map.set(event.toolUseId, {
        ...existing,
        state: 'running',
        taskId: event.taskId,
        description: event.description,
        taskType: event.taskType,
      })
    }

    if (event.type === 'task_notification') {
      // Resolve toolUseId: prefer the event's own, fall back to matching by taskId
      const resolvedToolUseId = event.toolUseId || taskIdToToolUseId.get(event.taskId)
      if (resolvedToolUseId) {
        consumedTaskIds.add(event.taskId)
        const existing = map.get(resolvedToolUseId)

        // task_notification carries the sub-agent's terminal status, but we do NOT
        // use it to drive `state` directly.  The sub-agent completing is NOT the same
        // as the Task tool call completing — the main agent still needs to receive the
        // tool_result and may continue generating content.  We store the SDK-reported
        // status as `notifiedStatus` metadata; the actual `state` transition happens
        // when the corresponding tool_result block arrives (Pass 2) or when the session
        // ends (resolveTaskFinalStates).
        //
        // Exception: 'failed' and 'stopped' are set immediately — these are error states
        // that likely won't produce a normal tool_result, and users should see them ASAP.
        const isTerminalError = event.status === 'failed' || event.status === 'stopped'

        map.set(resolvedToolUseId, {
          ...existing,
          state: isTerminalError ? event.status : (existing?.state ?? 'running'),
          notifiedStatus: event.status as 'completed' | 'failed' | 'stopped',
          taskId: event.taskId,
          summary: event.summary,
          outputFile: event.outputFile,
          durationMs: event.usage?.durationMs,
          totalTokens: event.usage?.totalTokens,
          toolUses: event.usage?.toolUses,
        })
      }
    }
  }

  // ── Pass 2: message ordering inference + tool_result collection ────────────
  // Track unresolved Task tool_use IDs.  When a new assistant or user message
  // appears, any previously tracked (earlier-turn) Task must have completed —
  // the SDK finishes all tool executions before generating the next turn.
  //
  // Simultaneously, capture tool_result blocks that belong to known Task entries.

  let unresolvedTaskIds: string[] = []

  for (const msg of messages) {
    if (msg.role === 'assistant' || msg.role === 'user') {
      // A new turn → all previously tracked tasks are done.
      // Use notifiedStatus for accuracy if available (e.g. sub-agent reported 'failed'),
      // otherwise default to 'completed' (the SDK finished all tools before this turn).
      for (const id of unresolvedTaskIds) {
        const existing = map.get(id)
        if (existing && (existing.state === 'running' || existing.state === 'pending')) {
          map.set(id, { ...existing, state: existing.notifiedStatus ?? 'completed' })
        }
      }
      unresolvedTaskIds = []

      // Collect Task tool_use IDs + tool_result content from this assistant message
      if (msg.role === 'assistant') {
        for (const block of msg.content) {
          if (block.type === 'tool_use' && (block.name === 'Agent' || block.name === 'Task')) {
            // Ensure the block has a map entry (even without system events)
            if (!map.has(block.id)) {
              map.set(block.id, { state: 'pending' })
            }
            unresolvedTaskIds.push(block.id)
          }
          // Capture tool_result for known Task tool_use IDs.
          // This is also the primary driver of the completed/failed state transition:
          // the tool_result arriving means the SDK has returned the sub-agent's output
          // to the main agent — the Task tool call is genuinely finished.
          if (block.type === 'tool_result') {
            const existing = map.get(block.toolUseId)
            if (existing) {
              // Derive terminal state: use notifiedStatus if available (most accurate),
              // infer from isError flag, or default to 'completed'.
              const terminalState: TaskAgentState = existing.notifiedStatus
                ?? (block.isError ? 'failed' : 'completed')

              map.set(block.toolUseId, {
                ...existing,
                state: terminalState,
                resultContent: block.content,
                resultIsError: block.isError,
              })
            }
          }
        }
      }
    }
  }
  // Note: unresolvedTaskIds from the LAST turn are NOT upgraded here —
  // they might genuinely still be running.  resolveTaskFinalStates handles
  // that case based on session lifecycle.

  return { map, consumedTaskIds }
}

/**
 * Resolve terminal states for unfinished tasks based on session lifecycle.
 *
 * When the session is no longer actively processing (`creating` / `streaming`),
 * all remaining `running` / `pending` tasks are inferred as finished:
 *
 *   - Natural completion (`stopReason` is null or `'completed'`) → `'completed'`
 *   - Interrupted (`stopReason` is `'max_turns'` / `'user_stopped'` / etc.) → `'stopped'`
 *
 * Returns the original `scannedMap` reference unchanged when no modifications
 * are needed (active session, or no unresolved tasks), preserving referential
 * identity for downstream React memoization.
 */
export function resolveTaskFinalStates(
  scannedMap: TaskEventsMap,
  sessionState?: ManagedSessionState,
  stopReason?: SessionStopReason | null,
): TaskEventsMap {
  const isSessionActive = sessionState != null && ACTIVE_SESSION_STATES.has(sessionState)
  if (isSessionActive) return scannedMap

  const wasInterrupted = stopReason != null && stopReason !== 'completed'
  const inferredState: TaskAgentState = wasInterrupted ? 'stopped' : 'completed'

  // Check whether any entries actually need updating before cloning
  let needsUpdate = false
  for (const [, info] of scannedMap) {
    if (info.state === 'running' || info.state === 'pending') {
      needsUpdate = true
      break
    }
  }
  if (!needsUpdate) return scannedMap

  // Clone and apply — never mutate the memoized scan result
  const resolved = new Map<string, TaskLifecycleInfo>()
  for (const [toolUseId, info] of scannedMap) {
    if (info.state === 'running' || info.state === 'pending') {
      resolved.set(toolUseId, { ...info, state: inferredState })
    } else {
      resolved.set(toolUseId, info)
    }
  }
  return resolved
}

/**
 * Check whether a system event has been consumed by TaskExecutionView.
 *
 * An event is consumed when its `taskId` appears in the `consumedTaskIds` set
 * (built by {@link buildTaskLifecycleMap}).  This covers both events WITH `toolUseId`
 * and those linked by `taskId` fallback.
 */
export function isConsumedTaskEvent(event: SystemEvent, consumedTaskIds: ReadonlySet<string>): boolean {
  return (
    (event.type === 'task_started' || event.type === 'task_notification') &&
    consumedTaskIds.has(event.taskId)
  )
}

// ─── State → visual mapping ─────────────────────────────────────────────────

interface StateVisual {
  icon: React.ReactNode
  label: string
  colorClass: string
}

const AGENT_TYPE_LABELS: Record<string, string> = {
  Explore: 'Explore',
  Bash: 'Bash',
  Plan: 'Plan',
  'general-purpose': 'Agent',
  'statusline-setup': 'Setup'
}

/** i18n key for each agent state label (under sessions:taskWidget.state.*) */
const STATE_LABEL_KEYS: Record<TaskAgentState, string> = {
  pending: 'taskWidget.state.launching',
  running: 'taskWidget.state.running',
  completed: 'taskWidget.state.completed',
  failed: 'taskWidget.state.failed',
  stopped: 'taskWidget.state.interrupted',
}

function getStateVisual(state: TaskAgentState, t: (key: string) => string): StateVisual {
  const label = t(STATE_LABEL_KEYS[state])
  switch (state) {
    case 'pending':
      return {
        icon: <Loader2 className="w-3 h-3 shrink-0 motion-safe:animate-spin" aria-hidden="true" />,
        label,
        colorClass: 'text-[hsl(var(--muted-foreground))]'
      }
    case 'running':
      return {
        icon: <span className="sparkle-spinner w-3 h-3 shrink-0 inline-flex items-center justify-center text-xs" aria-hidden="true" />,
        label,
        colorClass: 'text-blue-500'
      }
    case 'completed':
      return {
        icon: <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden="true" />,
        label,
        colorClass: 'text-green-500'
      }
    case 'failed':
      return {
        icon: <XCircle className="w-3 h-3 shrink-0" aria-hidden="true" />,
        label,
        colorClass: 'text-red-500'
      }
    case 'stopped':
      return {
        icon: <PauseCircle className="w-3 h-3 shrink-0" aria-hidden="true" />,
        label,
        colorClass: 'text-yellow-500'
      }
  }
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`
}

// ─── Result output collapse helpers ─────────────────────────────────────────

const RESULT_COLLAPSE_THRESHOLD = 20

// ─── TaskExecutionView ──────────────────────────────────────────────────────
//
// First-class rendering of a Task (sub-agent) execution as a cohesive unit.
// Orchestrates four focused sub-components: Header, Progress, Summary, and
// ResultOutput — replacing the old ToolUseBlockView pill + TaskAgentCard.

interface TaskExecutionViewProps {
  /** The tool_use block for the Task call (carries input + progress). */
  block: ToolUseBlock
  /** Immediate execution state from activeToolUseId (faster than system events). */
  isExecuting?: boolean
}

export const TaskExecutionView = memo(function TaskExecutionView({
  block,
  isExecuting,
}: TaskExecutionViewProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const lifecycle = useTaskLifecycle(block.id)
  const [expanded, setExpanded] = useState(false)

  // ── Derive display data ────────────────────────────────────────────────
  const subagentType = (block.input.subagent_type as string | undefined) ?? ''
  const description = (block.input.description as string | undefined) ?? ''

  // State: isExecuting is the fastest signal (from activeToolUseId). When the
  // lifecycle map only has a placeholder 'pending' entry but the tool is already
  // executing, promote to 'running' immediately instead of waiting for the
  // task_started system event to arrive.
  const state: TaskAgentState =
    lifecycle?.state === 'pending' && isExecuting
      ? 'running'
      : lifecycle?.state ?? (isExecuting ? 'running' : 'pending')
  const visual = getStateVisual(state, t)
  const agentLabel = AGENT_TYPE_LABELS[subagentType] ?? (subagentType || 'Agent')

  // Prompt is always available — card is always expandable
  const prompt = (block.input.prompt as string | undefined) ?? ''
  const hasExpandableContent = !!prompt || !!lifecycle?.summary || !!lifecycle?.resultContent || !!block.progress
  const isRunning = state === 'pending' || state === 'running'

  return (
    <div
      className="mt-1 rounded-xl border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))]"
      role="region"
      aria-label={`Sub-agent: ${description}`}
    >
      {/* ── Header — always visible ───────────────────────────────────── */}
      <TaskHeader
        visual={visual}
        agentLabel={agentLabel}
        description={description}
        durationMs={lifecycle?.durationMs}
        expanded={expanded}
        hasExpandableContent={hasExpandableContent}
        onToggle={() => hasExpandableContent && setExpanded((prev) => !prev)}
      />

      {/* ── Expanded body ─────────────────────────────────────────────── */}
      {expanded && (
        <div className="px-2.5 pb-2 space-y-1.5">
          <TaskPrompt prompt={prompt} />
          <TaskProgress progress={block.progress} isRunning={isRunning} />
          <TaskSummary summary={lifecycle?.summary} lifecycle={lifecycle} />
          <TaskResultOutput
            content={lifecycle?.resultContent}
            isError={lifecycle?.resultIsError}
          />
        </div>
      )}
    </div>
  )
})

// ─── Sub-components ─────────────────────────────────────────────────────────

/** Header row: state icon, agent badge, description, and duration/label. */
function TaskHeader({
  visual,
  agentLabel,
  description,
  durationMs,
  expanded,
  hasExpandableContent,
  onToggle,
}: {
  visual: StateVisual
  agentLabel: string
  description: string
  durationMs?: number
  expanded: boolean
  hasExpandableContent: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onToggle}
      className={cn(
        'w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left rounded-xl',
        hasExpandableContent && 'hover:bg-[hsl(var(--foreground)/0.02)] transition-colors',
      )}
      aria-expanded={hasExpandableContent ? expanded : undefined}
      tabIndex={hasExpandableContent ? 0 : -1}
    >
      {hasExpandableContent && (
        <ChevronRight
          className={cn(
            'w-3 h-3 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform duration-150',
            expanded && 'rotate-90',
          )}
          aria-hidden="true"
        />
      )}
      <span className={visual.colorClass}>{visual.icon}</span>
      <span className="text-xs font-medium text-[hsl(var(--foreground))] bg-[hsl(var(--muted)/0.6)] rounded-md px-1.5 py-0.5">
        {agentLabel}
      </span>
      {description && (
        <span className="text-[13px] text-[hsl(var(--muted-foreground))] truncate min-w-0">
          {description}
        </span>
      )}
      <span className={cn('ml-auto text-xs font-mono shrink-0', visual.colorClass)}>
        {durationMs != null ? formatDuration(durationMs) : visual.label}
      </span>
    </button>
  )
}

/** The prompt sent to the sub-agent — always available, shown first in expanded view. */
function TaskPrompt({ prompt }: { prompt: string }): React.JSX.Element | null {
  const { t } = useTranslation('sessions')
  const [promptExpanded, setPromptExpanded] = useState(false)

  if (!prompt) return null

  // Collapse long prompts — show first N lines with expand toggle
  const PROMPT_PREVIEW_LINES = 8
  const lines = prompt.split('\n')
  const isLong = lines.length > PROMPT_PREVIEW_LINES
  const displayText = promptExpanded ? prompt : lines.slice(0, PROMPT_PREVIEW_LINES).join('\n')

  return (
    <div>
      <pre className="text-xs font-mono text-[hsl(var(--muted-foreground)/0.7)] whitespace-pre-wrap break-words max-h-60 overflow-y-auto leading-normal rounded-md bg-[hsl(var(--background))] px-2 py-1.5">
        {displayText}
        {isLong && !promptExpanded && '\n…'}
      </pre>
      {isLong && (
        <button
          onClick={(e) => { e.stopPropagation(); setPromptExpanded((v) => !v) }}
          className="mt-0.5 text-xs text-[hsl(var(--primary))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded-sm px-0.5"
        >
          {promptExpanded ? t('taskWidget.showLess') : t('taskWidget.showMore', { count: lines.length })}
        </button>
      )}
    </div>
  )
}

/** Real-time SDK progress output (visible during execution). */
function TaskProgress({
  progress,
  isRunning,
}: {
  progress?: string
  isRunning: boolean
}): React.JSX.Element | null {
  if (!progress || !isRunning) return null
  return (
    <pre className="text-xs font-mono text-[hsl(var(--muted-foreground))] whitespace-pre-wrap break-words max-h-40 overflow-y-auto leading-normal rounded-md bg-[hsl(var(--background))] px-2 py-1">
      {progress}
    </pre>
  )
}

/** Summary text + usage stats. */
function TaskSummary({
  summary,
  lifecycle,
}: {
  summary?: string
  lifecycle?: TaskLifecycleInfo
}): React.JSX.Element | null {
  const { t } = useTranslation('sessions')
  const hasUsage = lifecycle?.durationMs != null
  if (!summary && !hasUsage) return null
  return (
    <>
      {summary && (
        <p className="text-xs text-[hsl(var(--muted-foreground)/0.8)] leading-relaxed">
          {summary}
        </p>
      )}
      {hasUsage && (
        <p className="text-[10px] font-mono text-[hsl(var(--muted-foreground)/0.5)]">
          {lifecycle!.totalTokens != null && (
            <span>{t('taskWidget.tokens', { count: lifecycle!.totalTokens, formattedCount: formatTokens(lifecycle!.totalTokens) })}</span>
          )}
          {lifecycle!.toolUses != null && (
            <span> · {t('taskWidget.tools', { count: lifecycle!.toolUses })}</span>
          )}
          {lifecycle!.durationMs != null && (
            <span> · {formatDuration(lifecycle!.durationMs)}</span>
          )}
        </p>
      )}
    </>
  )
}

/** Collapsible sub-agent result output (from tool_result). */
function TaskResultOutput({
  content,
  isError,
}: {
  content?: string
  isError?: boolean
}): React.JSX.Element | null {
  const { t } = useTranslation('sessions')
  const [resultExpanded, setResultExpanded] = useState(false)

  if (!content) return null

  const lines = content.split('\n')
  const isLong = lines.length > RESULT_COLLAPSE_THRESHOLD
  const displayContent = resultExpanded
    ? content
    : lines.slice(0, RESULT_COLLAPSE_THRESHOLD).join('\n')

  return (
    <div className={cn(
      'rounded-md text-xs',
      isError && 'border-l-2 border-red-500',
    )}>
      <pre className="font-mono text-[hsl(var(--muted-foreground))] whitespace-pre-wrap break-words overflow-x-auto leading-normal max-h-60 overflow-y-auto bg-[hsl(var(--background))] rounded-md px-2 py-1">
        {displayContent}
      </pre>
      {isLong && !resultExpanded && (
        <button
          onClick={(e) => { e.stopPropagation(); setResultExpanded(true) }}
          className="mt-0.5 text-xs text-[hsl(var(--primary))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded-sm px-0.5"
          aria-label={t('taskWidget.showMore', { count: lines.length })}
        >
          {t('taskWidget.showMore', { count: lines.length })}
        </button>
      )}
      {isLong && resultExpanded && (
        <button
          onClick={(e) => { e.stopPropagation(); setResultExpanded(false) }}
          className="mt-0.5 text-xs text-[hsl(var(--primary))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded-sm px-0.5"
          aria-label={t('taskWidget.showLess')}
        >
          {t('taskWidget.showLess')}
        </button>
      )}
    </div>
  )
}
