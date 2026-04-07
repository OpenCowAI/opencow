// SPDX-License-Identifier: Apache-2.0

/**
 * ScheduleNativeCapability — OpenCow built-in native capability for Schedule management.
 *
 * Exposes 7 MCP tools that allow Claude to manage Schedules on behalf of the user:
 *   list_schedules    — filter, paginate schedule list
 *   get_schedule      — retrieve full details + next runs preview
 *   create_schedule   — create a new schedule (projectId auto-bound from session context)
 *   update_schedule   — partial update (trigger, action, name, priority, projectId)
 *   pause_schedule    — pause an active schedule
 *   resume_schedule   — resume a paused schedule
 *   preview_next_runs — preview future execution times (before or after creation)
 *
 * delete_schedule is intentionally omitted — AI agents should not hold irreversible
 * destructive power. Use the OpenCow UI to delete schedules.
 *
 * Key design decisions:
 *   - NativeCapabilitySessionContext is bound into tool closures (not exposed as params)
 *   - create_schedule uses three-value projectId semantics (same as IssueNativeCapability):
 *       undefined = use session's projectId (auto-link to current project)
 *       null      = explicitly no project
 *       "id"      = link to specific project
 *   - trigger and action are structured objects (not flattened) — reflects domain structure
 *   - Advanced policies (failurePolicy, missedPolicy, concurrencyPolicy) are hidden from
 *     MCP tools — they use sensible defaults. Users can adjust via UI if needed.
 *   - Validation and mapping extracted as module-level pure functions (testable, reusable)
 *   - timestamps serialised as ISO 8601 strings
 *   - pagination: limit + offset (memory-level slice) + hasMore flag
 *
 * Tool handlers run in-process (Electron main), directly calling ScheduleService.
 * No extra process, no network round-trips.
 */

import { z } from 'zod/v4'
import type { NativeCapabilityMeta, NativeCapabilityToolContext, NativeCapabilitySessionContext } from './types'
import { BaseNativeCapability, type ToolConfig } from './baseNativeCapability'
import type { ScheduleService } from '../services/schedule/scheduleService'
import type { LifecycleOperationCoordinator } from '../services/lifecycleOperations'
import type {
  Schedule,
  SchedulePriority,
  ScheduleFrequency,
  ScheduleTrigger,
  ScheduleAction,
  ScheduleFilter,
  UpdateScheduleInput,
  FrequencyType,
  WorkMode,
  ActionType,
  ContextInjectionType,
  SessionLifecycleOperationProposalInput,
} from '../../src/shared/types'

// ─── Dependencies ─────────────────────────────────────────────────────────────

export interface ScheduleNativeCapabilityDeps {
  scheduleService: ScheduleService
  lifecycleOperationCoordinator?: LifecycleOperationCoordinator
}

// ─── Text normalisation ──────────────────────────────────────────────────────

/**
 * Normalise literal escape sequences that LLMs sometimes produce in JSON tool
 * call strings.  After JSON.parse the two-char sequence `\` + `n` survives as
 * the literal text "\\n" rather than a real newline — this helper converts it.
 */
function normaliseLlmText(text: string): string {
  return text.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum schedules returned by list_schedules (prevents flooding Claude's context). */
const LIST_MAX = 100
const LIST_DEFAULT = 30

// ─── MCP Input Types (tool-level, not domain-level) ───────────────────────────

/** MCP trigger input — simplified projection of ScheduleTrigger. */
interface TriggerInput {
  frequency: FrequencyType
  timeOfDay?: string
  timezone?: string
  daysOfWeek?: number[]
  dayOfMonth?: number
  intervalMinutes?: number
  cronExpression?: string
  executeAt?: string  // ISO 8601 (LLM-friendly) → converted to ms internally
  workMode?: WorkMode
}

/** MCP action input — simplified projection of ScheduleAction. */
interface ActionInput {
  type?: ActionType
  prompt: string
  model?: string
  maxTurns?: number
  contextInjections?: ContextInjectionType[]
}

// ─── Validation (pure function, independently testable) ───────────────────────

/** Frequencies exposed via MCP tools — subset of domain FrequencyType (excludes biweekly). */
type McpFrequencyType = 'once' | 'interval' | 'daily' | 'weekly' | 'monthly' | 'cron'

/**
 * Frequency-specific required field rules.
 *
 * Declarative map — adding a new frequency type requires only one new entry,
 * not a new if-else branch. This is the data-driven alternative to the
 * procedural validation anti-pattern.
 *
 * Typed as Record<McpFrequencyType, ...> so that:
 *   - every exposed frequency has a rule (can't forget one)
 *   - key typos are caught at compile time
 */
const FREQUENCY_RULES: Record<McpFrequencyType, { required: (keyof TriggerInput)[]; hint: string }> = {
  once:     { required: ['executeAt'],                hint: 'Provide ISO 8601 date-time, e.g. "2026-03-15T09:00:00+08:00"' },
  interval: { required: ['intervalMinutes'],          hint: 'Provide interval in minutes, e.g. 60' },
  daily:    { required: ['timeOfDay'],                hint: 'Provide time in HH:MM format, e.g. "09:00"' },
  weekly:   { required: ['timeOfDay', 'daysOfWeek'],  hint: 'Provide timeOfDay and daysOfWeek, e.g. "09:00" and [1,3,5]' },
  monthly:  { required: ['timeOfDay', 'dayOfMonth'],  hint: 'Provide timeOfDay and dayOfMonth, e.g. "09:00" and 15' },
  cron:     { required: ['cronExpression'],           hint: 'Provide cron expression, e.g. "0 9 * * 1-5"' },
}

/**
 * Validate trigger input for semantic completeness.
 * Pure function — no side effects, independently testable.
 *
 * @returns Error if validation fails, null if valid.
 */
function validateTriggerInput(input: TriggerInput): Error | null {
  const rule = FREQUENCY_RULES[input.frequency as McpFrequencyType]
  if (!rule) return null

  const missing = rule.required.filter(
    (field) => input[field] === undefined || input[field] === null,
  )
  if (missing.length > 0) {
    return new Error(
      `Missing required field(s) for ${input.frequency} frequency: ${missing.join(', ')}. ${rule.hint}`,
    )
  }
  return null
}

// ─── Mapping (pure functions, no side effects) ────────────────────────────────

/**
 * Map MCP TriggerInput → domain ScheduleTrigger.
 * Fills defaults (timezone from system) and converts types (ISO string → ms).
 */
function toScheduleTrigger(input: TriggerInput): ScheduleTrigger {
  // Parse and validate executeAt (ISO 8601 → epoch ms) before constructing frequency
  let executeAtMs: number | undefined
  if (input.executeAt) {
    executeAtMs = new Date(input.executeAt).getTime()
    if (Number.isNaN(executeAtMs)) {
      throw new Error(`Invalid executeAt date: "${input.executeAt}". Use ISO 8601 format, e.g. "2026-03-15T09:00:00+08:00".`)
    }
  }

  const time: ScheduleFrequency = {
    type: input.frequency,
    workMode: input.workMode ?? 'all_days',
    timezone: input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    timeOfDay: input.timeOfDay,
    daysOfWeek: input.daysOfWeek,
    dayOfMonth: input.dayOfMonth,
    intervalMinutes: input.intervalMinutes,
    cronExpression: input.cronExpression,
    executeAt: executeAtMs,
  }
  return { time }
}

/**
 * Map MCP ActionInput → domain ScheduleAction.
 *
 * Pure field mapping only — does NOT set projectId or issueId.
 * Ownership fields (projectId, issueId) are set explicitly at the call site,
 * keeping this function a single-responsibility mapper that's independently testable.
 */
function toScheduleAction(input: ActionInput): ScheduleAction {
  return {
    type: input.type ?? 'start_session',
    session: {
      promptTemplate: normaliseLlmText(input.prompt),
      model: input.model,
      maxTurns: input.maxTurns,
    },
    contextInjections: input.contextInjections,
  }
}

// ─── Reusable Zod Schema Fragments ───────────────────────────────────────────

/**
 * Zod schema for trigger input — reused across create_schedule, update_schedule,
 * and preview_next_runs tools.
 *
 * This is a simplified projection of the full ScheduleTrigger domain type.
 * Advanced fields (biweeklyConfig, event triggers) are not exposed — they
 * can only be configured via the UI.
 */
const triggerSchema = z.object({
  frequency: z.enum(['once', 'interval', 'daily', 'weekly', 'monthly', 'cron'])
    .describe('How often to run: once | interval | daily | weekly | monthly | cron'),
  timeOfDay: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM (24-hour), e.g. "09:00"').optional()
    .describe('Time in HH:MM (24h). Required for daily/weekly/monthly. E.g. "09:00"'),
  timezone: z.string().optional()
    .describe('IANA timezone. Defaults to system timezone. E.g. "Asia/Shanghai"'),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional()
    .describe('For weekly: days of week (0=Sun..6=Sat). E.g. [1,3,5] for Mon/Wed/Fri'),
  dayOfMonth: z.number().int().min(1).max(31).optional()
    .describe('For monthly: day of month (1-31)'),
  intervalMinutes: z.number().int().min(1).optional()
    .describe('For interval: minutes between runs'),
  cronExpression: z.string().optional()
    .describe('For cron: expression. E.g. "0 9 * * 1-5" for weekdays at 9am'),
  executeAt: z.string().optional()
    .describe('For once: ISO 8601 date-time. E.g. "2026-03-15T09:00:00+08:00"'),
  workMode: z.enum(['all_days', 'weekdays']).optional()
    .describe('all_days (default) or weekdays (skip Sat/Sun)'),
}).describe('When to run — timing configuration')

/**
 * Zod schema for action input — reused across create_schedule and update_schedule.
 *
 * Only `start_session` and `create_issue` are exposed. `resume_session`, `webhook`,
 * and `notification` action types require complex configuration better handled in the UI.
 */
const actionSchema = z.object({
  type: z.enum(['start_session', 'create_issue']).default('start_session')
    .describe('What to do: start_session (default) or create_issue'),
  prompt: z.string()
    .describe('Prompt template for the session. Supports {{date}}, {{project}} placeholders'),
  model: z.string().optional()
    .describe('Model override. Omit to use default'),
  maxTurns: z.number().int().optional()
    .describe('Max agentic turns. Omit for unlimited'),
  contextInjections: z.array(z.enum([
    'git_diff_24h', 'git_log_week', 'last_execution_result',
    'open_issues', 'today_stats', 'recent_errors', 'changed_files',
  ])).optional()
    .describe('Dynamic context to inject into prompt at runtime'),
}).describe('What to do when triggered — action configuration')

// ─── ScheduleNativeCapability ─────────────────────────────────────────────────

export class ScheduleNativeCapability extends BaseNativeCapability {
  readonly meta: NativeCapabilityMeta = {
    category: 'schedules',
    name: 'Schedules',
    description: 'OpenCow Schedule management — list, create, update, pause and resume schedules',
    version: '1.0.0',
  }

  private readonly scheduleService: ScheduleService
  private readonly lifecycleOperationCoordinator: LifecycleOperationCoordinator | null

  constructor(deps: ScheduleNativeCapabilityDeps) {
    super()
    this.scheduleService = deps.scheduleService
    this.lifecycleOperationCoordinator = deps.lifecycleOperationCoordinator ?? null
  }

  protected toolConfigs(context: NativeCapabilityToolContext): ToolConfig[] {
    const session = context.session
    return [
      this.listSchedulesConfig(session),
      this.getScheduleConfig(),
      this.proposeScheduleOperationConfig(session),
      this.createScheduleConfig(session),
      this.updateScheduleConfig(),
      this.pauseScheduleConfig(),
      this.resumeScheduleConfig(),
      this.previewNextRunsConfig(),
    ]
  }

  // ── list_schedules ──────────────────────────────────────────────────────────

  private listSchedulesConfig(session: NativeCapabilitySessionContext): ToolConfig {
    const projectHint = session.projectId
      ? ` Your current project ID is "${session.projectId}" — use projectId to scope results.`
      : ''

    return {
      name: 'list_schedules',
      description:
        'List scheduled tasks with optional filtering and pagination. ' +
        'Returns compact summaries (no full trigger/action configs). ' +
        `Use get_schedule for full details. Defaults to ${LIST_DEFAULT} results; max ${LIST_MAX}.` +
        projectHint,
      schema: {
        statuses: z
          .array(z.enum(['active', 'paused', 'completed', 'error']))
          .optional()
          .describe('Filter by one or more statuses (OR semantics)'),
        projectId: z
          .string()
          .optional()
          .describe('Filter by project ID'),
        search: z
          .string()
          .optional()
          .describe('Search by schedule name'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIST_MAX)
          .default(LIST_DEFAULT)
          .describe(`Results per page (1–${LIST_MAX}, default ${LIST_DEFAULT})`),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('Number of schedules to skip (for pagination). Use with limit.'),
      },
      execute: async (args) => {
        const filter: ScheduleFilter = {}
        if (args.statuses) filter.statuses = args.statuses as ScheduleFilter['statuses']
        if (args.projectId) filter.projectId = args.projectId as string
        if (args.search) filter.search = args.search as string

        const all = await this.scheduleService.list(filter)
        const limit = (args.limit as number) ?? LIST_DEFAULT
        const offset = (args.offset as number) ?? 0
        const page = all.slice(offset, offset + limit)

        return this.textResult(JSON.stringify({
          total:    all.length,
          returned: page.length,
          offset,
          hasMore:  offset + page.length < all.length,
          schedules: page.map((s) => this.toSummary(s)),
        }, null, 2))
      },
    }
  }

  // ── get_schedule ────────────────────────────────────────────────────────────

  private getScheduleConfig(): ToolConfig {
    return {
      name: 'get_schedule',
      description:
        'Retrieve full details of a schedule by its ID, including trigger config, ' +
        'action config, execution stats, and preview of next 5 scheduled runs.',
      schema: {
        id: z.string().describe('The schedule ID to retrieve'),
      },
      execute: async (args) => {
        const id = args.id as string
        const schedule = await this.scheduleService.get(id)
        if (!schedule) {
          return this.errorResult(new Error(`Schedule not found: ${id}`))
        }

        // Preview next 5 runs alongside full details
        const nextRuns = this.scheduleService
          .previewNextRuns(schedule.trigger, 5)
          .map((ts) => new Date(ts).toISOString())

        return this.textResult(JSON.stringify({
          ...this.toDetail(schedule),
          nextRunsPreview: nextRuns,
        }, null, 2))
      },
    }
  }

  // ── create_schedule ─────────────────────────────────────────────────────────

  /**
   * Creates the create_schedule tool config with session context bound from
   * NativeCapabilityToolContext.
   *
   * projectId is captured from session context and auto-injected (three-value semantics):
   *   - undefined (not provided) → auto-link to session's project (default behavior)
   *   - null (explicitly null)   → create without any project association
   *   - "proj-xxx" (explicit ID) → link to the specified project
   */
  private createScheduleConfig(session: NativeCapabilitySessionContext): ToolConfig {
    const projectHint = session.projectId
      ? ' When called from a project context, the schedule is automatically linked ' +
        'to the current project unless you explicitly set projectId to null or a different ID.'
      : ''

    return {
      name: 'create_schedule',
      description:
        'Create a new scheduled task that automatically runs at specified times. ' +
        'IMPORTANT: Only call this tool when the user explicitly asks to create a schedule. ' +
        'Do NOT proactively create schedules.' +
        projectHint,
      schema: {
        name: z
          .string()
          .describe('Schedule name — concise description of what this does'),
        description: z
          .string()
          .optional()
          .describe('Optional longer description of the schedule purpose'),
        trigger: triggerSchema,
        action: actionSchema,
        projectId: z
          .string()
          .nullable()
          .optional()
          .describe(
            'Project to associate. Omit to use current project context; ' +
            'pass null for no project; pass a project ID for a specific project.',
          ),
        issueId: z
          .string()
          .optional()
          .describe('Optional related issue ID'),
        priority: z
          .enum(['critical', 'high', 'normal', 'low'])
          .default('normal')
          .describe('Schedule priority: critical | high | normal (default) | low'),
      },
      execute: async (args) => {
        const triggerInput = args.trigger as TriggerInput
        const actionInput = args.action as ActionInput

        // 1. Validate trigger completeness
        const validationError = validateTriggerInput(triggerInput)
        if (validationError) return this.errorResult(validationError)

        // 2. Three-value projectId semantics
        const resolvedProjectId = args.projectId === undefined
          ? session.projectId
          : args.projectId as string | null

        // 3. Map MCP input → domain model
        const trigger = toScheduleTrigger(triggerInput)
        const action = toScheduleAction(actionInput)

        // 4. Ownership injection — explicitly set on action (not in toScheduleAction)
        // Service uses action.projectId as canonical source for Schedule.projectId.
        action.projectId = resolvedProjectId ?? undefined
        if (args.issueId) {
          action.issueId = args.issueId as string
        }

        // 5. Delegate to service
        // Note: NOT passing top-level projectId — service reads from action.projectId
        // (canonical source). Passing both would be dead code and create confusion.
        const schedule = await this.scheduleService.create({
          name:        normaliseLlmText(args.name as string),
          description: typeof args.description === 'string' ? normaliseLlmText(args.description) : undefined,
          trigger,
          action,
          priority:    args.priority    as SchedulePriority | undefined,
        })

        return this.textResult(JSON.stringify(this.toDetail(schedule), null, 2))
      },
    }
  }

  // ── propose_schedule_operation ─────────────────────────────────────────────

  private proposeScheduleOperationConfig(session: NativeCapabilitySessionContext): ToolConfig {
    return {
      name: 'propose_schedule_operation',
      description:
        'Propose one or more schedule lifecycle operations for confirmation in-session. ' +
        'This tool does not directly mutate schedule records in Phase A.',
      schema: {
        userInstruction: z
          .string()
          .optional()
          .describe('Original user instruction used for explicit no-confirm detection'),
        operations: z
          .array(z.object({
            action: z.enum(['create', 'update', 'pause', 'resume', 'trigger_now']),
            normalizedPayload: z.record(z.string(), z.unknown()),
            summary: z.record(z.string(), z.unknown()).optional(),
            warnings: z.array(z.string()).optional(),
            confirmationMode: z.enum(['required', 'auto_if_user_explicit']).optional(),
            idempotencyKey: z.string().optional(),
          }))
          .min(1)
          .describe('Structured schedule lifecycle proposals'),
      },
      execute: async (args, input) => {
        if (!this.lifecycleOperationCoordinator) {
          return this.errorResult(new Error('Lifecycle operation coordinator is not available'))
        }

        const toolUseId = input.context.toolUseId ?? input.context.invocationId ?? 'missing-tool-use-id'
        const operationArgs = args.operations as Array<Record<string, unknown>>
        const proposals: SessionLifecycleOperationProposalInput[] = operationArgs.map((candidate) => ({
          entity: 'schedule',
          action: candidate.action as SessionLifecycleOperationProposalInput['action'],
          normalizedPayload: {
            ...(candidate.normalizedPayload as Record<string, unknown>),
            projectId:
              (candidate.normalizedPayload as Record<string, unknown>)?.projectId === undefined
                ? session.projectId
                : (candidate.normalizedPayload as Record<string, unknown>).projectId,
          },
          summary: candidate.summary as Record<string, unknown> | undefined,
          warnings: candidate.warnings as string[] | undefined,
          confirmationMode: candidate.confirmationMode as SessionLifecycleOperationProposalInput['confirmationMode'] | undefined,
          idempotencyKey: typeof candidate.idempotencyKey === 'string' ? candidate.idempotencyKey : undefined,
          userInstruction: typeof args.userInstruction === 'string' ? args.userInstruction : undefined,
        }))

        const envelopes = await this.lifecycleOperationCoordinator.proposeOperations({
          sessionId: session.sessionId,
          toolUseId,
          proposals,
        })

        return this.textResult(JSON.stringify(envelopes, null, 2))
      },
    }
  }

  // ── update_schedule ─────────────────────────────────────────────────────────

  private updateScheduleConfig(): ToolConfig {
    return {
      name: 'update_schedule',
      description:
        'Update one or more fields of an existing schedule. Only provided fields are changed. ' +
        'Pass trigger to replace the entire timing config; pass action to replace the entire action config. ' +
        'IMPORTANT: Only call when user explicitly asks to update a schedule. ' +
        'Do NOT automatically change schedules on your own initiative.',
      schema: {
        id: z
          .string()
          .describe('Schedule ID to update'),
        name: z
          .string()
          .optional()
          .describe('New name'),
        description: z
          .string()
          .optional()
          .describe('New description'),
        trigger: triggerSchema
          .optional()
          .describe('New trigger config — replaces entire trigger when provided'),
        action: actionSchema
          .optional()
          .describe('New action config — replaces entire action when provided'),
        priority: z
          .enum(['critical', 'high', 'normal', 'low'])
          .optional()
          .describe('New priority'),
        projectId: z
          .string()
          .nullable()
          .optional()
          .describe('Move schedule to a different project. Pass null to detach from any project.'),
      },
      execute: async (args) => {
        const id = args.id as string
        const patch: UpdateScheduleInput = {}

        if (args.name        !== undefined) patch.name        = normaliseLlmText(args.name as string)
        if (args.description !== undefined) patch.description = normaliseLlmText(args.description as string)
        if (args.priority    !== undefined) patch.priority    = args.priority    as SchedulePriority

        // Structured trigger: if provided, validate and replace entirely
        if (args.trigger !== undefined) {
          const triggerInput = args.trigger as TriggerInput
          const validationError = validateTriggerInput(triggerInput)
          if (validationError) return this.errorResult(validationError)
          patch.trigger = toScheduleTrigger(triggerInput)
        }

        // Structured action: if provided, replace entirely
        // Service treats action.projectId as canonical source for Schedule.projectId,
        // so we must explicitly set it to prevent losing project association.
        if (args.action !== undefined) {
          patch.action = toScheduleAction(args.action as ActionInput)

          if (args.projectId !== undefined) {
            // Explicit projectId provided alongside action — use it directly (no pre-fetch)
            patch.action.projectId = (args.projectId as string | null) ?? undefined
          } else {
            // No explicit projectId — carry over from existing schedule to avoid
            // silently nulling out the project association. This single read is
            // unavoidable given the service's action.projectId-as-canonical design.
            const existing = await this.scheduleService.get(id)
            if (!existing) return this.errorResult(new Error(`Schedule not found: ${id}`))
            patch.action.projectId = existing.projectId ?? undefined
          }
        } else if (args.projectId !== undefined) {
          // Only projectId changes (no action change) — use top-level UpdateScheduleInput.projectId
          patch.projectId = args.projectId as string | null
        }

        if (Object.keys(patch).length === 0) {
          return this.errorResult(new Error(
            'No fields to update. Provide at least one of: name, description, trigger, action, priority, projectId.',
          ))
        }

        // Single update operation — no TOCTOU pre-check for the update itself.
        // updateSchedule returns null if the schedule does not exist.
        const updated = await this.scheduleService.update(id, patch)
        if (!updated) return this.errorResult(new Error(`Schedule not found: ${id}`))

        return this.textResult(JSON.stringify(this.toDetail(updated), null, 2))
      },
    }
  }

  // ── pause_schedule ──────────────────────────────────────────────────────────

  private pauseScheduleConfig(): ToolConfig {
    return {
      name: 'pause_schedule',
      description:
        'Pause an active schedule. It stops executing until resumed. ' +
        'IMPORTANT: Only call when user explicitly asks.',
      schema: {
        id: z.string().describe('Schedule ID to pause'),
      },
      execute: async (args) => {
        const id = args.id as string
        const updated = await this.scheduleService.pause(id)
        if (!updated) return this.errorResult(new Error(`Schedule not found: ${id}`))
        return this.textResult(JSON.stringify(this.toSummary(updated), null, 2))
      },
    }
  }

  // ── resume_schedule ─────────────────────────────────────────────────────────

  private resumeScheduleConfig(): ToolConfig {
    return {
      name: 'resume_schedule',
      description:
        'Resume a paused schedule. Resets consecutive failure count and recalculates next run. ' +
        'IMPORTANT: Only call when user explicitly asks.',
      schema: {
        id: z.string().describe('Schedule ID to resume'),
      },
      execute: async (args) => {
        const id = args.id as string
        const updated = await this.scheduleService.resume(id)
        if (!updated) return this.errorResult(new Error(`Schedule not found: ${id}`))
        return this.textResult(JSON.stringify(this.toSummary(updated), null, 2))
      },
    }
  }

  // ── preview_next_runs ───────────────────────────────────────────────────────

  private previewNextRunsConfig(): ToolConfig {
    return {
      name: 'preview_next_runs',
      description:
        'Preview the next N execution times. Two modes: ' +
        '(1) by schedule ID — preview an existing schedule; ' +
        '(2) by trigger config — preview before creating. Provide one of id or trigger.',
      schema: {
        id: z
          .string()
          .optional()
          .describe('Existing schedule ID to preview'),
        trigger: triggerSchema
          .optional()
          .describe('Trigger config to preview (for pre-creation validation)'),
        count: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(5)
          .describe('Number of runs to preview (1-20, default 5)'),
      },
      execute: async (args) => {
        const count = (args.count as number) ?? 5
        let trigger: ScheduleTrigger
        let label: string

        if (args.id) {
          // Mode 1: preview existing schedule
          const schedule = await this.scheduleService.get(args.id as string)
          if (!schedule) return this.errorResult(new Error(`Schedule not found: ${args.id}`))
          trigger = schedule.trigger
          label = schedule.name
        } else if (args.trigger) {
          // Mode 2: preview trigger config (pre-creation)
          const triggerInput = args.trigger as TriggerInput
          const validationError = validateTriggerInput(triggerInput)
          if (validationError) return this.errorResult(validationError)
          trigger = toScheduleTrigger(triggerInput)
          label = `${triggerInput.frequency} preview`
        } else {
          return this.errorResult(
            new Error('Provide either id (existing schedule) or trigger (pre-creation preview).'),
          )
        }

        const nextRuns = this.scheduleService
          .previewNextRuns(trigger, count)
          .map((ts) => new Date(ts).toISOString())

        return this.textResult(JSON.stringify({
          label,
          frequency: trigger.time?.type ?? 'event-based',
          nextRuns,
        }, null, 2))
      },
    }
  }

  // ── Serialisation helpers ───────────────────────────────────────────────────

  /**
   * Compact summary for list responses.
   * Omits full trigger/action config — keeps list compact for Claude's context.
   * Timestamps are ISO 8601 strings for human/LLM readability.
   */
  private toSummary(schedule: Schedule): Record<string, unknown> {
    return {
      id:             schedule.id,
      name:           schedule.name,
      status:         schedule.status,
      priority:       schedule.priority,
      frequency:      schedule.trigger.time?.type ?? 'event',
      actionType:     schedule.action.type,
      projectId:      schedule.projectId,
      nextRunAt:      schedule.nextRunAt  ? new Date(schedule.nextRunAt).toISOString()  : null,
      lastRunAt:      schedule.lastRunAt  ? new Date(schedule.lastRunAt).toISOString()  : null,
      lastRunStatus:  schedule.lastRunStatus,
      executionCount: schedule.executionCount,
      createdAt:      new Date(schedule.createdAt).toISOString(),
      updatedAt:      new Date(schedule.updatedAt).toISOString(),
    }
  }

  /**
   * Full detail for get/create/update responses.
   * Includes complete trigger and action configs.
   * Timestamps are ISO 8601 strings.
   */
  private toDetail(schedule: Schedule): Record<string, unknown> {
    return {
      id:          schedule.id,
      name:        schedule.name,
      description: schedule.description || null,  // "" → null
      status:      schedule.status,
      priority:    schedule.priority,
      projectId:   schedule.projectId,

      // Trigger: full config for round-trip readability
      trigger: {
        frequency:       schedule.trigger.time?.type ?? null,
        timeOfDay:       schedule.trigger.time?.timeOfDay ?? null,
        timezone:        schedule.trigger.time?.timezone ?? null,
        daysOfWeek:      schedule.trigger.time?.daysOfWeek ?? null,
        dayOfMonth:      schedule.trigger.time?.dayOfMonth ?? null,
        intervalMinutes: schedule.trigger.time?.intervalMinutes ?? null,
        cronExpression:  schedule.trigger.time?.cronExpression ?? null,
        executeAt:       schedule.trigger.time?.executeAt
          ? new Date(schedule.trigger.time.executeAt).toISOString()
          : null,
        workMode:        schedule.trigger.time?.workMode ?? null,
        event:           schedule.trigger.event ?? null,
      },

      // Action: full config
      action: {
        type:              schedule.action.type,
        promptTemplate:    schedule.action.session?.promptTemplate ?? null,
        model:             schedule.action.session?.model ?? null,
        maxTurns:          schedule.action.session?.maxTurns ?? null,
        contextInjections: schedule.action.contextInjections ?? [],
        issueId:           schedule.action.issueId ?? null,
      },

      // Runtime state
      nextRunAt:           schedule.nextRunAt  ? new Date(schedule.nextRunAt).toISOString()  : null,
      lastRunAt:           schedule.lastRunAt  ? new Date(schedule.lastRunAt).toISOString()  : null,
      lastRunStatus:       schedule.lastRunStatus,
      lastRunError:        schedule.lastRunError,
      executionCount:      schedule.executionCount,
      consecutiveFailures: schedule.consecutiveFailures,

      // Boundary conditions
      startDate:     schedule.startDate  ? new Date(schedule.startDate).toISOString()  : null,
      endDate:       schedule.endDate    ? new Date(schedule.endDate).toISOString()    : null,
      maxExecutions: schedule.maxExecutions ?? null,

      createdAt: new Date(schedule.createdAt).toISOString(),
      updatedAt: new Date(schedule.updatedAt).toISOString(),
    }
  }
}
