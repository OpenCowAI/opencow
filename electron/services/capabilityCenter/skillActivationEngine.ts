// SPDX-License-Identifier: Apache-2.0

/**
 * Skill activation engine — decides which skills enter the capability plan
 * in 'full' mode (body injected) vs 'catalog' mode (metadata only).
 *
 * Phase 1B.11d: the implicit keyword matching scorer has been removed.
 * Skill discovery and activation is now model-driven via the SDK's built-in
 * SkillTool — the model reads the SkillTool catalog and calls Skill('name')
 * when it decides to activate a skill. No framework-side keyword scoring.
 *
 * Remaining activation sources:
 *   - 'always'   — skill.metadata.always === true
 *   - 'agent'    — agent metadata declares the skill as a dependency
 *   - 'explicit' — user typed /skill-name (slash command)
 *   - 'default'  — catalog-only projection (not activated)
 */

import type { DocumentCapabilityEntry } from '@shared/types'

export type SkillPromptMode = 'catalog' | 'full'

export type SkillActivationSource =
  | 'default'
  | 'always'
  | 'agent'
  | 'explicit'

export interface SkillActivationPolicy {
  // Retained for interface compatibility; no longer has any effect.
  implicit: { enabled: boolean }
}

export interface SkillActivationInput {
  explicitSkillNames: ReadonlySet<string>
  agentSkillNames: ReadonlySet<string>
  implicitQuery?: string  // No longer used; kept for caller compatibility
}

export interface SkillActivationDecision {
  skillName: string
  mode: SkillPromptMode
  source: SkillActivationSource
  reason: string
  score?: number
  threshold?: number
}

const DEFAULT_POLICY: SkillActivationPolicy = {
  implicit: { enabled: false },
}

export function resolveSkillActivationPolicy(
  _overrides?: Partial<{ enabled: boolean }>,
): SkillActivationPolicy {
  return DEFAULT_POLICY
}

export function resolveSkillActivationDecisions(
  skills: DocumentCapabilityEntry[],
  input: SkillActivationInput,
  _policy: SkillActivationPolicy,
): SkillActivationDecision[] {
  return skills.map((skill) => {
    if (skill.metadata?.['always'] === true) {
      return {
        skillName: skill.name,
        mode: 'full',
        source: 'always',
        reason: 'metadata.always=true',
      }
    }

    if (input.agentSkillNames.has(skill.name)) {
      return {
        skillName: skill.name,
        mode: 'full',
        source: 'agent',
        reason: 'agent metadata includes skill',
      }
    }

    if (input.explicitSkillNames.has(skill.name)) {
      return {
        skillName: skill.name,
        mode: 'full',
        source: 'explicit',
        reason: 'explicit slash activation',
      }
    }

    return {
      skillName: skill.name,
      mode: 'catalog',
      source: 'default',
      reason: 'default catalog projection',
    }
  })
}
