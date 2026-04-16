// SPDX-License-Identifier: Apache-2.0

import type {
  SessionOrigin,
  StartSessionNativeToolAllowItem,
  StartSessionPolicyInput,
  UserMessageContent,
} from '../../../src/shared/types'
import {
  resolveActivatedSkillNames,
  resolveImplicitSkillActivationQuery,
} from '../skillActivationResolver'
import { extractNativeRequirementsFromContent } from '../../../src/shared/slashExecution'

export interface BuildSessionPolicyInput {
  origin: SessionOrigin
  policy?: StartSessionPolicyInput
  prompt?: UserMessageContent
}

export function buildSessionPolicyInput(input: BuildSessionPolicyInput): StartSessionPolicyInput | undefined {
  const defaults = resolveDefaultPolicyByOrigin(input.origin)
  const merged = mergePolicyInputs(defaults, input.policy)
  return applyPromptPolicyDerivation(merged, derivePromptPolicy(input.prompt))
}

interface PromptPolicyDerivation {
  explicitSkillNames: string[]
  implicitQuery?: string
  requiredNativeAllow: StartSessionNativeToolAllowItem[]
}

function derivePromptPolicy(prompt: UserMessageContent | undefined): PromptPolicyDerivation {
  if (!prompt) {
    return {
      explicitSkillNames: [],
      implicitQuery: undefined,
      requiredNativeAllow: [],
    }
  }
  const explicitSkillNames = resolveActivatedSkillNames(prompt)
  return {
    explicitSkillNames,
    // Phase 1B.11d: implicit keyword matching removed. Skill discovery is
    // now model-driven via the SDK's built-in SkillTool. The model reads
    // the SkillTool catalog and calls Skill('name') when it decides to
    // activate a skill — no framework-side keyword scoring needed.
    implicitQuery: undefined,
    requiredNativeAllow: extractNativeRequirementsFromContent(prompt),
  }
}

/**
 * Default native-tool allowlist for general-purpose sessions.
 *
 * All 8 native capabilities are exposed by default — capability-level, not
 * tool-level. Token cost is bounded (~5.6K for all tools across all 8
 * capabilities) and amortised by prompt caching.
 *
 * The previous narrow allowlist (browser + html + 3 tool-scoped entries)
 * caused session `ccb-XTyTIQFpUSI-` to fail: user asked "list issues" but
 * `list_issues` was not in the allowlist, so the model fell back to
 * `gh issue list` in Bash. Root cause: conflating visibility with governance.
 * Governance for mutating operations lives in LifecycleOperationCoordinator
 * (confirmation flow), not in the allowlist.
 *
 * Builtin tools remain enabled (not overridden here).
 */
const GENERAL_PURPOSE_NATIVE_TOOLS: StartSessionNativeToolAllowItem[] = [
  { capability: 'browser' },
  { capability: 'html' },
  { capability: 'interaction' },
  { capability: 'issues' },
  { capability: 'projects' },
  { capability: 'schedules' },
  { capability: 'evose' },
  // Lifecycle — apply/cancel tools for pending issue/schedule proposals.
  // Always enabled alongside issues + schedules so the Propose→Confirm loop
  // can close from chat ("确定" / "confirm") and not just via the UI card.
  { capability: 'lifecycle' },
]

/**
 * Resolve the default session policy based on origin type.
 *
 * Design: **general-purpose by default, explicit opt-out for specialised origins.**
 *
 * This inverted logic ensures new origins (e.g. a future WhatsApp channel)
 * automatically inherit browser capability without requiring a code change here.
 * Only origins with genuinely different needs are listed explicitly:
 *
 *   - `browser-agent`:     browser-only, no builtin tools (specialised workspace)
 *   - `market-analyzer`:   no native tools, reduced skill budget (analysis sandbox)
 *   - `*-creator`:         focused creation flows — no native tools needed
 */
function resolveDefaultPolicyByOrigin(origin: SessionOrigin): StartSessionPolicyInput | undefined {
  switch (origin.source) {
    // ── Specialised: browser-only workspace, builtin tools disabled ──
    case 'browser-agent':
      return {
        tools: {
          builtin: { enabled: false },
          native: {
            mode: 'allowlist',
            allow: [{ capability: 'browser' }],
          },
        },
      }

    // ── Specialised: marketplace analysis sandbox ────────────────────
    case 'market-analyzer':
      return {
        tools: {
          builtin: { enabled: false },
          native: {
            mode: 'none',
            allow: [],
          },
        },
        capabilities: {
          skill: {
            maxChars: 24_000,
            explicit: [],
          },
        },
      }

    // ── Creator flows: focused conversational UI, no native tools ────
    case 'skill-creator':
    case 'agent-creator':
    case 'command-creator':
    case 'rule-creator':
    case 'bot-creator':
      return undefined

    // ── Issue/Schedule lifecycle sources: explicitly expose propose tools ──
    case 'issue':
    case 'schedule':
    case 'issue-creator':
    case 'schedule-creator':
      return {
        tools: {
          native: {
            mode: 'allowlist',
            allow: [...GENERAL_PURPOSE_NATIVE_TOOLS],
          },
        },
      }

    // ── All other origins: general-purpose with browser ──────────────
    default:
      return {
        tools: {
          native: {
            mode: 'allowlist',
            allow: [...GENERAL_PURPOSE_NATIVE_TOOLS],
          },
        },
      }
  }
}

function mergePolicyInputs(
  base: StartSessionPolicyInput | undefined,
  override: StartSessionPolicyInput | undefined,
): StartSessionPolicyInput | undefined {
  if (!base && !override) return undefined
  if (!base) return clonePolicyInput(override)
  if (!override) return clonePolicyInput(base)

  const mergedTools = mergeTools(base.tools, override.tools)
  const mergedCapabilities = mergeCapabilities(base.capabilities, override.capabilities)

  return {
    ...(mergedTools ? { tools: mergedTools } : {}),
    ...(mergedCapabilities ? { capabilities: mergedCapabilities } : {}),
  }
}

function applyPromptPolicyDerivation(
  base: StartSessionPolicyInput | undefined,
  derivation: PromptPolicyDerivation,
): StartSessionPolicyInput | undefined {
  const hasPromptSignals =
    derivation.explicitSkillNames.length > 0 ||
    derivation.implicitQuery !== undefined ||
    derivation.requiredNativeAllow.length > 0
  if (!hasPromptSignals) {
    return base
  }

  const next = clonePolicyInput(base) ?? {}

  if (derivation.explicitSkillNames.length > 0 || derivation.implicitQuery !== undefined) {
    const currentSkill = next.capabilities?.skill
    const mergedExplicit = mergeStringLists(currentSkill?.explicit, derivation.explicitSkillNames)

    const nextSkill: NonNullable<NonNullable<StartSessionPolicyInput['capabilities']>['skill']> = {
      ...(currentSkill ?? {}),
      explicit: mergedExplicit,
      implicitQuery: currentSkill?.implicitQuery ?? derivation.implicitQuery,
    }

    next.capabilities = {
      ...(next.capabilities ?? {}),
      skill: nextSkill,
    }
  }

  if (derivation.requiredNativeAllow.length > 0) {
    const currentNative = next.tools?.native
    const mergedAllow = mergeAllowlists(currentNative?.allow, derivation.requiredNativeAllow)

    next.tools = {
      ...(next.tools ?? {}),
      native: {
        ...(currentNative ?? {}),
        mode: 'allowlist',
        allow: mergedAllow,
      },
    }
  }

  return next
}

function mergeTools(
  base: StartSessionPolicyInput['tools'] | undefined,
  override: StartSessionPolicyInput['tools'] | undefined,
): StartSessionPolicyInput['tools'] | undefined {
  if (!base && !override) return undefined

  const builtinEnabled = override?.builtin?.enabled ?? base?.builtin?.enabled
  const nativeMode = override?.native?.mode ?? base?.native?.mode
  const nativeAllow = cloneAllowlist(override?.native?.allow ?? base?.native?.allow)

  const tools: NonNullable<StartSessionPolicyInput['tools']> = {}
  if (builtinEnabled !== undefined) {
    tools.builtin = { enabled: builtinEnabled }
  }
  if (nativeMode !== undefined || nativeAllow !== undefined) {
    tools.native = {
      ...(nativeMode !== undefined ? { mode: nativeMode } : {}),
      ...(nativeAllow !== undefined ? { allow: nativeAllow } : {}),
    }
  }

  return Object.keys(tools).length > 0 ? tools : undefined
}

function mergeCapabilities(
  base: StartSessionPolicyInput['capabilities'] | undefined,
  override: StartSessionPolicyInput['capabilities'] | undefined,
): StartSessionPolicyInput['capabilities'] | undefined {
  if (!base && !override) return undefined

  const skillMaxChars = override?.skill?.maxChars ?? base?.skill?.maxChars
  const skillExplicit = cloneStringList(override?.skill?.explicit ?? base?.skill?.explicit)
  const skillImplicitQuery = override?.skill?.implicitQuery ?? base?.skill?.implicitQuery

  const capabilities: NonNullable<StartSessionPolicyInput['capabilities']> = {}
  if (skillMaxChars !== undefined || skillExplicit !== undefined || skillImplicitQuery !== undefined) {
    capabilities.skill = {
      ...(skillMaxChars !== undefined ? { maxChars: skillMaxChars } : {}),
      ...(skillExplicit !== undefined ? { explicit: skillExplicit } : {}),
      ...(skillImplicitQuery !== undefined ? { implicitQuery: skillImplicitQuery } : {}),
    }
  }

  return Object.keys(capabilities).length > 0 ? capabilities : undefined
}

function clonePolicyInput(policy: StartSessionPolicyInput | undefined): StartSessionPolicyInput | undefined {
  if (!policy) return undefined
  return {
    ...(policy.tools ? { tools: mergeTools(undefined, policy.tools) } : {}),
    ...(policy.capabilities ? { capabilities: mergeCapabilities(undefined, policy.capabilities) } : {}),
  }
}

function cloneAllowlist(
  allowlist: StartSessionNativeToolAllowItem[] | undefined,
): StartSessionNativeToolAllowItem[] | undefined {
  if (!allowlist) return undefined
  return allowlist.map((item) =>
    item.tool !== undefined
      ? { capability: item.capability, tool: item.tool }
      : { capability: item.capability },
  )
}

function cloneStringList(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined
  return [...values]
}

function mergeAllowlists(
  base: StartSessionNativeToolAllowItem[] | undefined,
  patch: StartSessionNativeToolAllowItem[],
): StartSessionNativeToolAllowItem[] {
  const out: StartSessionNativeToolAllowItem[] = []
  const seen = new Set<string>()

  const append = (item: StartSessionNativeToolAllowItem): void => {
    const capability = item.capability.trim()
    if (!capability) return
    const tool = item.tool?.trim()
    const key = `${capability}::${tool ?? '*'}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(tool ? { capability, tool } : { capability })
  }

  for (const item of base ?? []) append(item)
  for (const item of patch) append(item)
  return out
}

function mergeStringLists(base: string[] | undefined, patch: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const append = (value: string): void => {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    out.push(normalized)
  }
  for (const value of base ?? []) append(value)
  for (const value of patch) append(value)
  return out
}
