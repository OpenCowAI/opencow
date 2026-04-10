// SPDX-License-Identifier: Apache-2.0

import { calcPrice, type Usage } from '@pydantic/genai-prices'
import type { AIEngineKind } from './types'

export type ContextWindowCatalogErrorCode =
  | 'catalog_lookup_failed'

export interface ContextWindowCatalogDiagnostic {
  readonly code: ContextWindowCatalogErrorCode
  readonly message: string
  readonly context: Record<string, unknown>
}

export interface ContextWindowCatalogQuery {
  readonly engineKind: AIEngineKind
  readonly model: string | null
  /** Optional provider hint to reduce ambiguous catalog matches. */
  readonly providerHint?: string
}

export interface ContextWindowCatalog {
  resolveContextWindow(query: ContextWindowCatalogQuery): {
    limitTokens: number | null
    diagnostic: ContextWindowCatalogDiagnostic | null
  }
}

const ENGINE_TO_PROVIDER_HINT: Partial<Record<AIEngineKind, string>> = {
  claude: 'anthropic',
}

function normalizeContextWindow(value: number | null | undefined): number | null {
  if (value == null) return null
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.max(1, Math.trunc(value))
}

function cacheKeyFor(query: ContextWindowCatalogQuery): string {
  return `${query.engineKind}:${query.providerHint ?? ''}:${(query.model ?? '').toLowerCase()}`
}

const ZERO_USAGE: Usage = {
  input_tokens: 0,
  output_tokens: 0,
}

function lookupContextWindow(params: {
  model: string
  providerId?: string
}): number | null {
  const result = calcPrice(
    ZERO_USAGE,
    params.model,
    params.providerId ? { providerId: params.providerId } : undefined,
  )
  return normalizeContextWindow(result?.model.context_window)
}

export class GenaiPricesContextWindowCatalog implements ContextWindowCatalog {
  private readonly cache = new Map<string, number | null>()

  resolveContextWindow(query: ContextWindowCatalogQuery): {
    limitTokens: number | null
    diagnostic: ContextWindowCatalogDiagnostic | null
  } {
    if (!query.model) return { limitTokens: null, diagnostic: null }

    const hintedProvider = query.providerHint ?? ENGINE_TO_PROVIDER_HINT[query.engineKind]
    const key = cacheKeyFor({ ...query, providerHint: hintedProvider })
    if (this.cache.has(key)) {
      return { limitTokens: this.cache.get(key) ?? null, diagnostic: null }
    }

    try {
      let limitTokens = hintedProvider
        ? lookupContextWindow({ model: query.model, providerId: hintedProvider })
        : null
      if (limitTokens == null) {
        limitTokens = lookupContextWindow({ model: query.model })
      }
      this.cache.set(key, limitTokens)
      return { limitTokens, diagnostic: null }
    } catch (error) {
      const diagnostic: ContextWindowCatalogDiagnostic = {
        code: 'catalog_lookup_failed',
        message: 'Failed to resolve context_window from genai-prices',
        context: {
          engineKind: query.engineKind,
          model: query.model,
          providerHint: hintedProvider ?? null,
          error: error instanceof Error ? error.message : String(error),
        },
      }
      return { limitTokens: null, diagnostic }
    }
  }
}

let globalCatalog: ContextWindowCatalog = new GenaiPricesContextWindowCatalog()

export function getContextWindowCatalog(): ContextWindowCatalog {
  return globalCatalog
}

export function setContextWindowCatalogForTest(catalog: ContextWindowCatalog): void {
  globalCatalog = catalog
}

export function resetContextWindowCatalogForTest(): void {
  globalCatalog = new GenaiPricesContextWindowCatalog()
}
