// SPDX-License-Identifier: Apache-2.0

import type {
  SessionOrigin,
  StartSessionNativeToolAllowItem,
  StartSessionPolicy,
  StartSessionPolicyInput,
  UserMessageContent,
} from '../../../src/shared/types'
import {
  resolveActivatedSkillNames,
  resolveImplicitSkillActivationQuery,
} from '../skillActivationResolver'
import { extractNativeRequirementsFromContent } from '../../../src/shared/slashExecution'
import { buildSessionPolicyInput } from './sessionPolicyInputFactory'
import { resolveStartSessionPolicy } from './startSessionPolicy'

export interface SessionPromptActivation {
  explicitSkillNames: string[]
  implicitQuery?: string
  requiredNativeAllowlist: StartSessionNativeToolAllowItem[]
}

export interface PlanSessionPolicyInput {
  origin: SessionOrigin
  policy?: StartSessionPolicyInput
  prompt?: UserMessageContent
}

export interface SessionPolicyPlan {
  policyInput?: StartSessionPolicyInput
  effectivePolicy: StartSessionPolicy
  activation: SessionPromptActivation
}

export function planSessionPolicy(input: PlanSessionPolicyInput): SessionPolicyPlan {
  const activation = deriveSessionPromptActivation(input.prompt)
  const policyInput = buildSessionPolicyInput({
    origin: input.origin,
    policy: input.policy,
    prompt: input.prompt,
  })
  const effectivePolicy = resolveStartSessionPolicy({
    policy: policyInput,
  })
  return {
    policyInput,
    effectivePolicy,
    activation,
  }
}

export function deriveSessionPromptActivation(
  prompt: UserMessageContent | undefined,
): SessionPromptActivation {
  if (!prompt) {
    return {
      explicitSkillNames: [],
      implicitQuery: undefined,
      requiredNativeAllowlist: [],
    }
  }

  return {
    explicitSkillNames: resolveActivatedSkillNames(prompt),
    implicitQuery: resolveImplicitSkillActivationQuery(prompt),
    requiredNativeAllowlist: extractNativeRequirementsFromContent(prompt),
  }
}

export function policySatisfiesRequiredNativeAllowlist(
  policy: StartSessionPolicy | undefined,
  requiredAllow: StartSessionNativeToolAllowItem[],
): boolean {
  if (requiredAllow.length === 0) return true
  if (!policy) return false
  if (policy.tools.native.mode !== 'allowlist') return false

  return requiredAllow.every((required) =>
    allowlistContainsRequiredEntry(policy.tools.native.allow, required),
  )
}

function allowlistContainsRequiredEntry(
  activeAllow: StartSessionNativeToolAllowItem[],
  required: StartSessionNativeToolAllowItem,
): boolean {
  const requiredCapability = required.capability.trim()
  const requiredTool = required.tool?.trim()
  if (!requiredCapability) return true

  if (!requiredTool) {
    return activeAllow.some(
      (entry) => entry.capability === requiredCapability && entry.tool === undefined,
    )
  }

  return activeAllow.some((entry) =>
    entry.capability === requiredCapability &&
      (entry.tool === undefined || entry.tool === requiredTool),
  )
}
