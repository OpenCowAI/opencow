// SPDX-License-Identifier: Apache-2.0

/**
 * Session Injector — builds a CapabilityPlan from a CapabilitySnapshot.
 *
 * Responsibilities in this module are intentionally limited to orchestration:
 * - load and filter capability candidates
 * - invoke activation, rendering, and budget components
 * - assemble final SDK-agnostic CapabilityPlan
 */

import type {
  DocumentCapabilityEntry,
  CapabilitySnapshot,
  AIEngineKind,
  StartSessionNativeToolAllowItem,
} from '@shared/types'
import { isPlainObject } from '@shared/typeGuards'
import type { StateRepository } from './stateRepository'
import type { DeclarativeHookGroup } from './hookCallbackAdapter'
import { createLogger } from '../../platform/logger'
import { resolveDistributionTargetType } from './distributionTargets'
import {
  resolveSkillActivationDecisions,
  resolveSkillActivationPolicy,
  type ImplicitSkillMatchPolicy,
  type SkillActivationDecision,
  type SkillActivationSource,
} from './skillActivationEngine'
import {
  buildRulePromptSegment,
  buildSkillPromptSegment,
  type SkillPromptSegment,
} from './promptSegmentBuilder'
import { allocateWithinBudget, type BudgetCandidate } from './promptBudgetAllocator'

const log = createLogger('SessionInjector')

const DEFAULT_MAX_SKILL_CHARS_BY_ENGINE: Readonly<Record<AIEngineKind, number>> = {
  claude: 80_000,
  codex: 24_000,
}

export interface McpServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  [key: string]: string | string[] | Record<string, string> | undefined
}

export interface PlanSummarySkillDecision {
  skillName: string
  mode: 'catalog' | 'full'
  source: SkillActivationSource
  selected: boolean
  reason: string
  score?: number
  threshold?: number
}

export interface CapabilityPlan {
  capabilityPrompt: string
  agentPrompt: string | null
  declarativeHooks: Record<string, DeclarativeHookGroup[]>
  mcpServers: Record<string, McpServerConfig>
  /**
   * Native tool requirements self-declared by activated skills.
   *
   * Each skill provider sets `metadata.nativeRequirements` to describe what
   * native capabilities its skills need at runtime (e.g. Evose skills declare
   * `[{ capability: 'evose' }]`). This field aggregates and deduplicates
   * those declarations across all skills activated in "full" mode.
   *
   * The session orchestrator merges these into the native tool allowlist
   * **before** registering tools, closing the temporal gap where implicit
   * skill activation could inject prompts referencing tools the session
   * never made available.
   */
  nativeRequirements: StartSessionNativeToolAllowItem[]
  totalChars: number
  summary: PlanSummary
}

export interface PlanSummary {
  skills: string[]
  agent: string | null
  rules: string[]
  hooks: string[]
  mcpServers: string[]
  skippedDistributed: string[]
  skippedByBudget: string[]
  skillDecisions: PlanSummarySkillDecision[]
}

export interface CapabilityPlanRequest {
  session: {
    engineKind: AIEngineKind
    agentName?: string
  }
  activation?: {
    explicitSkillNames?: string[]
    implicitQuery?: string
  }
  policy?: {
    maxSkillChars?: number
    implicit?: Partial<ImplicitSkillMatchPolicy>
  }
}

export async function buildCapabilityPlan(params: {
  snapshot: CapabilitySnapshot
  stateRepo: StateRepository
  request: CapabilityPlanRequest
}): Promise<CapabilityPlan> {
  const { snapshot, stateRepo, request } = params
  const { engineKind, agentName } = request.session
  const maxSkillChars = request.policy?.maxSkillChars ?? DEFAULT_MAX_SKILL_CHARS_BY_ENGINE[engineKind]

  let skills = snapshot.skills.filter((entry) => entry.enabled && entry.eligibility.eligible)
  const distributionResult = await filterDistributedSkills(skills, stateRepo, engineKind)
  skills = distributionResult.skills

  const agent = agentName
    ? snapshot.agents.find((entry) => entry.name === agentName && entry.enabled)
    : null

  const explicitSkillNames = new Set(request.activation?.explicitSkillNames ?? [])
  const agentSkillNames = resolveAgentSkillNames(agent)

  if (explicitSkillNames.size > 0) {
    skills = skills.filter((skill) => {
      if (skill.metadata?.['always'] === true) return true
      if (agentSkillNames.has(skill.name)) return true
      return explicitSkillNames.has(skill.name)
    })
  }

  skills.sort((left, right) => {
    const leftHighPriority = left.metadata?.['always'] === true || agentSkillNames.has(left.name)
    const rightHighPriority = right.metadata?.['always'] === true || agentSkillNames.has(right.name)
    if (leftHighPriority && !rightHighPriority) return -1
    if (!leftHighPriority && rightHighPriority) return 1
    return left.name.localeCompare(right.name)
  })

  const activationDecisions = resolveSkillActivationDecisions(
    skills,
    {
      explicitSkillNames,
      agentSkillNames,
      implicitQuery: request.activation?.implicitQuery,
    },
    resolveSkillActivationPolicy(request.policy?.implicit),
  )

  const decisionsBySkillName = new Map<string, SkillActivationDecision>(
    activationDecisions.map((decision) => [decision.skillName, decision]),
  )

  const skillSegments = skills.map((skill) => {
    const decision = decisionsBySkillName.get(skill.name)
    if (!decision) {
      throw new Error(`Missing activation decision for skill "${skill.name}"`)
    }
    return buildSkillPromptSegment(skill, decision)
  })

  const budgetCandidates: Array<BudgetCandidate<SkillPromptSegment>> = skillSegments.map((segment, index) => ({
    id: segment.id,
    order: index,
    priority: toSkillSegmentPriority(segment.source, segment.mode),
    charCost: segment.charCost,
    payload: segment,
  }))

  const budgetResult = allocateWithinBudget(budgetCandidates, maxSkillChars)
  const selectedSkillSegments = budgetResult.selected.map((candidate) => candidate.payload)
  const skippedByBudget = budgetResult.dropped.map((candidate) => candidate.payload.skillName)

  if (skippedByBudget.length > 0) {
    log.info(
      `Skill prompt budget reached (${budgetResult.usedChars}/${budgetResult.maxChars} chars); skipped=[${skippedByBudget.join(', ')}]`,
    )
  }

  const rules = snapshot.rules.filter((entry) => entry.enabled && entry.eligibility.eligible)
  const ruleSegments = rules.map((rule) => buildRulePromptSegment(rule))

  const capabilityPrompt = [
    ...selectedSkillSegments.map((segment) => segment.content),
    ...ruleSegments.map((segment) => segment.content),
  ].join('\n\n')

  const agentPrompt = agent?.body ?? null

  const enabledHooks = snapshot.hooks.filter((entry) => entry.enabled)
  const declarativeHooks: Record<string, DeclarativeHookGroup[]> = {}
  for (const hook of enabledHooks) {
    const rawEvents = hook.config?.['events']
    if (!isPlainObject(rawEvents)) continue
    for (const [event, groups] of Object.entries(rawEvents)) {
      if (!Array.isArray(groups)) continue
      if (!declarativeHooks[event]) declarativeHooks[event] = []
      declarativeHooks[event].push(...(groups as DeclarativeHookGroup[]))
    }
  }

  const enabledMcpServers = snapshot.mcpServers.filter(
    (entry) => entry.enabled && entry.eligibility.eligible,
  )

  const mcpServers: Record<string, McpServerConfig> = {}
  for (const mcp of enabledMcpServers) {
    const raw = mcp.config?.['serverConfig'] ?? mcp.config
    if (isPlainObject(raw)) {
      mcpServers[mcp.name] = raw as McpServerConfig
    } else {
      log.warn(`MCP server "${mcp.name}" skipped: config.serverConfig is not a plain object`, { config: mcp.config })
    }
  }

  const selectedSkillNameSet = new Set(selectedSkillSegments.map((segment) => segment.skillName))

  // Collect native tool requirements ONLY from budget-selected skills.
  // A skill that was dropped by the budget allocator has no prompt in the
  // system message — Claude cannot see or invoke it, so registering its
  // native tools would be a resource waste and a logical inconsistency.
  const selectedSkills = skills.filter((s) => selectedSkillNameSet.has(s.name))
  const nativeRequirements = collectNativeRequirementsFromSkills(selectedSkills, decisionsBySkillName)

  return {
    capabilityPrompt,
    agentPrompt,
    declarativeHooks,
    mcpServers,
    nativeRequirements,
    totalChars: capabilityPrompt.length + (agentPrompt?.length ?? 0),
    summary: {
      skills: selectedSkillSegments.map((segment) => segment.skillName),
      agent: agent?.name ?? null,
      rules: rules.map((rule) => rule.name),
      hooks: enabledHooks.map((hook) => hook.name),
      mcpServers: enabledMcpServers.map((mcp) => mcp.name),
      skippedDistributed: distributionResult.skippedDistributed,
      skippedByBudget,
      skillDecisions: activationDecisions.map((decision) => ({
        skillName: decision.skillName,
        mode: decision.mode,
        source: decision.source,
        selected: selectedSkillNameSet.has(decision.skillName),
        reason: decision.reason,
        score: decision.score,
        threshold: decision.threshold,
      })),
    },
  }
}

async function filterDistributedSkills(
  skills: DocumentCapabilityEntry[],
  stateRepo: StateRepository,
  engineKind: AIEngineKind,
): Promise<{ skills: DocumentCapabilityEntry[]; skippedDistributed: string[] }> {
  const projectSkillNames = skills.filter((skill) => skill.scope === 'project').map((skill) => skill.name)
  const globalSkillNames = skills.filter((skill) => skill.scope === 'global').map((skill) => skill.name)

  const [projectDistributions, globalDistributions] = await Promise.all([
    stateRepo.batchGetDistributions('skill', projectSkillNames, {
      targetTypes: [mapScopeToTarget('project', engineKind)],
    }),
    stateRepo.batchGetDistributions('skill', globalSkillNames, {
      targetTypes: [mapScopeToTarget('global', engineKind)],
    }),
  ])

  const skippedDistributed: string[] = []
  const retained: DocumentCapabilityEntry[] = []

  for (const skill of skills) {
    const distributions = skill.scope === 'project' ? projectDistributions : globalDistributions
    if (distributions.get(skill.name)) {
      skippedDistributed.push(skill.name)
      continue
    }
    retained.push(skill)
  }

  return { skills: retained, skippedDistributed }
}

function resolveAgentSkillNames(agent: DocumentCapabilityEntry | null): Set<string> {
  const rawSkills = agent?.metadata?.['skills']
  const values = Array.isArray(rawSkills)
    ? rawSkills.filter((value): value is string => typeof value === 'string')
    : []
  return new Set(values)
}

function toSkillSegmentPriority(
  source: SkillActivationSource,
  mode: SkillPromptSegment['mode'],
): number {
  const base = (() => {
    switch (source) {
      case 'always':
        return 100
      case 'agent':
        return 90
      case 'explicit':
        return 80
      case 'implicit':
        return 70
      default:
        return 10
    }
  })()

  return mode === 'full' ? base + 5 : base
}

function mapScopeToTarget(scope: 'global' | 'project', engineKind: AIEngineKind): string {
  if (engineKind === 'claude') {
    return resolveDistributionTargetType({ scope, engineKind: 'claude' })
  }
  return resolveDistributionTargetType({ scope, engineKind: 'codex' })
}

/**
 * Collect native tool requirements declared by skills activated in "full" mode.
 *
 * Each skill provider declares what native capabilities it needs at runtime
 * via `metadata.nativeRequirements` (an array of `StartSessionNativeToolAllowItem`).
 * For example, Evose skills declare `[{ capability: 'evose' }]` so that the
 * `evose_run_agent` / `evose_run_workflow` tools become available.
 *
 * This function is **provider-agnostic** — it only reads the self-declared
 * metadata without any provider-specific branching. New providers simply set
 * their `nativeRequirements` in metadata and this function picks them up
 * automatically.
 *
 * Only skills in "full" mode are considered — catalog-only skills are not
 * invokable and should not pull in runtime dependencies.
 */
function collectNativeRequirementsFromSkills(
  skills: DocumentCapabilityEntry[],
  decisionsBySkillName: ReadonlyMap<string, SkillActivationDecision>,
): StartSessionNativeToolAllowItem[] {
  const seen = new Set<string>()
  const out: StartSessionNativeToolAllowItem[] = []

  for (const skill of skills) {
    const decision = decisionsBySkillName.get(skill.name)
    if (!decision || decision.mode !== 'full') continue

    const requirements = skill.metadata?.['nativeRequirements']
    if (!Array.isArray(requirements)) continue

    for (const req of requirements) {
      if (typeof req?.capability !== 'string') continue
      const key = `${req.capability}::${req.tool ?? '*'}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(req.tool
        ? { capability: req.capability, tool: req.tool }
        : { capability: req.capability })
    }
  }

  return out
}

/**
 * Lightweight check: resolve native requirements from skills that would be
 * implicitly activated by the given plain-text query.
 *
 * This is the reconfiguration counterpart to the full `buildCapabilityPlan`
 * pipeline. It runs only the implicit skill matching portion against skills
 * that declare `metadata.nativeRequirements`, then returns the aggregated
 * requirements.
 *
 * Use case: when `sendMessage()` pushes a follow-up message to a reused IM
 * session (WeChat, Telegram, etc.), the explicit reconfiguration check
 * (`decideSessionReconfiguration`) only catches slash-command requirements.
 * This function catches plain-text references to skills like Evose apps,
 * enabling the orchestrator to restart the lifecycle when the current session
 * lacks the required native tools.
 *
 * Excludes `always`-on skills since their requirements are guaranteed to be
 * present from session creation.
 */
export function resolveImplicitNativeRequirements(params: {
  snapshot: CapabilitySnapshot
  implicitQuery: string
}): StartSessionNativeToolAllowItem[] {
  const { snapshot, implicitQuery } = params

  // Filter for enabled, eligible skills that declare native requirements
  // and are NOT always-on (those are already active from session creation).
  const candidates = snapshot.skills.filter((entry) => {
    if (!entry.enabled || !entry.eligibility.eligible) return false
    if (entry.metadata?.['always'] === true) return false
    const reqs = entry.metadata?.['nativeRequirements']
    return Array.isArray(reqs) && reqs.length > 0
  })

  if (candidates.length === 0) return []

  const policy = resolveSkillActivationPolicy()
  const decisions = resolveSkillActivationDecisions(
    candidates,
    {
      explicitSkillNames: new Set(),
      agentSkillNames: new Set(),
      implicitQuery,
    },
    policy,
  )

  // Only consider skills activated via implicit matching — explicit and agent
  // activations are already handled by the existing reconfiguration paths.
  const implicitFullDecisions = new Map<string, SkillActivationDecision>()
  for (const d of decisions) {
    if (d.mode === 'full' && d.source === 'implicit') {
      implicitFullDecisions.set(d.skillName, d)
    }
  }

  if (implicitFullDecisions.size === 0) return []

  return collectNativeRequirementsFromSkills(candidates, implicitFullDecisions)
}
