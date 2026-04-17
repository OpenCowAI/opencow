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
  StartSessionNativeToolAllowItem,
} from '@shared/types'
import type { StateRepository } from './stateRepository'
import { extractSdkConfig, validateMcpConfig } from './shared/mcpServerConfig'
import { isPlainObject } from '@shared/typeGuards'
import type { DeclarativeHookGroup } from './hookCallbackAdapter'
import { createLogger } from '../../platform/logger'
import { resolveDistributionTargetType } from './distributionTargets'
import {
  resolveSkillActivationDecisions,
  resolveSkillActivationPolicy,
  type SkillActivationDecision,
  type SkillActivationSource,
} from './skillActivationEngine'
import {
  buildRulePromptSegment,
} from './promptSegmentBuilder'
// Phase 1B.11d: budget allocator import removed (skill prompt segments no longer built here)

const log = createLogger('SessionInjector')

const DEFAULT_MAX_SKILL_CHARS = 80_000

/**
 * SDK-ready MCP server config — opaque record passed directly to the SDK.
 *
 * We intentionally do NOT define named fields here. The actual shape is
 * validated by `validateMcpConfig()` from the shared mcpServerConfig module,
 * and the SDK's own Zod schema strips unrecognized keys at runtime.
 */
export type McpServerConfig = Record<string, unknown>

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
    agentName?: string
  }
  activation?: {
    explicitSkillNames?: string[]
    implicitQuery?: string
  }
  policy?: {
    maxSkillChars?: number
    implicit?: Partial<{ enabled: boolean }>
  }
}

export async function buildCapabilityPlan(params: {
  snapshot: CapabilitySnapshot
  stateRepo: StateRepository
  request: CapabilityPlanRequest
}): Promise<CapabilityPlan> {
  const { snapshot, stateRepo, request } = params
  const { agentName } = request.session
  const maxSkillChars = request.policy?.maxSkillChars ?? DEFAULT_MAX_SKILL_CHARS

  let skills = snapshot.skills.filter((entry) => entry.enabled && entry.eligibility.eligible)
  const distributionResult = await filterDistributedSkills(skills, stateRepo)
  skills = distributionResult.skills

  const agent = agentName
    ? snapshot.agents.find((entry) => entry.name === agentName && entry.enabled) ?? null
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

  // Phase 1B.11d: skill prompt segments removed from capabilityPrompt.
  // Skills are now surfaced via SDK's built-in SkillTool (Options.commands)
  // which handles catalog, delta-emit, and activation. Injecting skill
  // body into the static system prompt was the old "山寨" path — it
  // double-injected content (once here, once via SkillTool) and wasted
  // tokens. Only rules remain in capabilityPrompt.
  const skippedByBudget: string[] = []

  const rules = snapshot.rules.filter((entry) => entry.enabled && entry.eligibility.eligible)
  const ruleSegments = rules.map((rule) => buildRulePromptSegment(rule))

  const capabilityPrompt = ruleSegments.map((segment) => segment.content).join('\n\n')

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
    const sdkConfig = extractSdkConfig(mcp.config)
    if (!sdkConfig) {
      log.warn(`MCP server "${mcp.name}" skipped: unable to extract serverConfig`, { config: mcp.config })
      continue
    }

    // Validate before passing to SDK — invalid configs would cause a fatal
    // exit code 1 from the SDK's Zod schema validation.
    const validation = validateMcpConfig(sdkConfig)
    if (!validation.valid) {
      log.warn(`MCP server "${mcp.name}" skipped: ${validation.reason}`, { config: sdkConfig })
      continue
    }

    mcpServers[mcp.name] = sdkConfig
  }

  // Phase 1B.11d: nativeRequirements collected from ALL eligible skills (no
  // budget filtering — skills are no longer prompt-injected, so budget doesn't
  // control visibility). This preserves the EvoseSkillProvider bridge: Evose
  // skills declare nativeRequirements that add evose tools to the allowlist.
  const nativeRequirements = collectNativeRequirementsFromSkills(skills, decisionsBySkillName)

  return {
    capabilityPrompt,
    agentPrompt,
    declarativeHooks,
    mcpServers,
    nativeRequirements,
    totalChars: capabilityPrompt.length + (agentPrompt?.length ?? 0),
    summary: {
      skills: skills.map((s) => s.name),
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
        selected: decision.mode === 'full',
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
): Promise<{ skills: DocumentCapabilityEntry[]; skippedDistributed: string[] }> {
  const projectSkillNames = skills.filter((skill) => skill.scope === 'project').map((skill) => skill.name)
  const globalSkillNames = skills.filter((skill) => skill.scope === 'global').map((skill) => skill.name)

  const [projectDistributions, globalDistributions] = await Promise.all([
    stateRepo.batchGetDistributions('skill', projectSkillNames, {
      targetTypes: [mapScopeToTarget('project')],
    }),
    stateRepo.batchGetDistributions('skill', globalSkillNames, {
      targetTypes: [mapScopeToTarget('global')],
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

// Phase 1B.11d: toSkillSegmentPriority deleted (skill prompt segments removed)

function mapScopeToTarget(scope: 'global' | 'project'): string {
  return resolveDistributionTargetType({ scope, engineKind: 'claude' })
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

// Phase 1B.11d: resolveImplicitNativeRequirements deleted.
// Implicit keyword matching has been removed — skill activation is now
// model-driven via the SDK's built-in SkillTool. All native capabilities
// are exposed by default (commit d03bac05), so the nativeRequirements
// bridge is no longer needed to "unlock" tools from implicit skill matches.
