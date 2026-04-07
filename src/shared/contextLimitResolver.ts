// SPDX-License-Identifier: Apache-2.0

import type { SessionContextState } from './types'
import { getContextLimit } from './modelContextLimits'
import {
  getContextWindowCatalog,
  type ContextWindowCatalogDiagnostic,
} from './contextWindowCatalog'

export interface ContextLimitResolverInput {
  readonly engineKind: 'claude' | 'codex'
  readonly model: string | null
  readonly contextState: SessionContextState | null
  readonly contextLimitOverride: number | null | undefined
  readonly providerHint?: string
}

export interface ContextLimitResolverResult {
  readonly limitTokens: number
  readonly source: 'runtime_authoritative' | 'turn_result' | 'catalog' | 'static'
  readonly diagnostic: ContextWindowCatalogDiagnostic | null
}

function normalizeDynamicLimit(value: number | null | undefined): number | null {
  if (value == null) return null
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.max(1, Math.trunc(value))
}

export function resolveContextLimit(input: ContextLimitResolverInput): ContextLimitResolverResult {
  const runtimeAuthoritativeLimit = input.contextState?.confidence === 'authoritative'
    ? normalizeDynamicLimit(input.contextState.limitTokens)
    : null
  if (runtimeAuthoritativeLimit != null) {
    return {
      limitTokens: runtimeAuthoritativeLimit,
      source: 'runtime_authoritative',
      diagnostic: null,
    }
  }

  const turnResultLimit = normalizeDynamicLimit(input.contextLimitOverride)
  if (turnResultLimit != null) {
    return {
      limitTokens: turnResultLimit,
      source: 'turn_result',
      diagnostic: null,
    }
  }

  const catalogResult = getContextWindowCatalog().resolveContextWindow({
    engineKind: input.engineKind,
    model: input.model,
    providerHint: input.providerHint,
  })
  if (catalogResult.limitTokens != null) {
    return {
      limitTokens: catalogResult.limitTokens,
      source: 'catalog',
      diagnostic: null,
    }
  }

  return {
    limitTokens: getContextLimit({
      engineKind: input.engineKind,
      model: input.model,
    }),
    source: 'static',
    diagnostic: catalogResult.diagnostic,
  }
}
