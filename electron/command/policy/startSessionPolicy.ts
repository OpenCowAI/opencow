// SPDX-License-Identifier: Apache-2.0

import type {
  AIEngineKind,
  StartSessionNativeToolAllowItem,
  StartSessionPolicyInput,
  StartSessionPolicy,
} from '../../../src/shared/types'

const DEFAULT_SKILL_MAX_CHARS_BY_ENGINE: Readonly<Record<AIEngineKind, number>> = {
  claude: 80_000,
}

export interface ResolveStartSessionPolicyInput {
  engineKind: AIEngineKind
  policy?: StartSessionPolicyInput
}

export function resolveStartSessionPolicy(input: ResolveStartSessionPolicyInput): StartSessionPolicy {
  const defaultSkillMaxChars = DEFAULT_SKILL_MAX_CHARS_BY_ENGINE[input.engineKind]
  const raw = input.policy

  const builtinEnabled = raw?.tools?.builtin?.enabled ?? true
  const requestedNativeAllow = normalizeAllowlist(raw?.tools?.native?.allow ?? [])
  const nativeMode = raw?.tools?.native?.mode ?? (requestedNativeAllow.length > 0 ? 'allowlist' : 'none')
  const nativeAllow = nativeMode === 'allowlist' ? requestedNativeAllow : []

  const maxChars = normalizePositiveNumber(raw?.capabilities?.skill?.maxChars, defaultSkillMaxChars)
  const explicit = normalizeStringList(raw?.capabilities?.skill?.explicit ?? [])
  const implicitQuery = normalizeOptionalString(raw?.capabilities?.skill?.implicitQuery)

  return {
    tools: {
      builtin: { enabled: builtinEnabled },
      native: {
        mode: nativeMode,
        allow: nativeAllow,
      },
    },
    capabilities: {
      skill: {
        maxChars,
        explicit,
        implicitQuery,
      },
    },
  }
}

function normalizeAllowlist(allow: StartSessionNativeToolAllowItem[]): StartSessionNativeToolAllowItem[] {
  const out: StartSessionNativeToolAllowItem[] = []
  const seen = new Set<string>()
  for (const entry of allow) {
    const capability = normalizeOptionalString(entry.capability)
    if (!capability) continue
    const tool = normalizeOptionalString(entry.tool)
    const key = `${capability}::${tool ?? '*'}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tool ? { capability, tool } : { capability })
  }
  return out
}

function normalizeStringList(values: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = normalizeOptionalString(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback
  }
  return Math.trunc(value)
}
