// SPDX-License-Identifier: Apache-2.0

import type { DocumentCapabilityEntry } from '@shared/types'

export type SkillPromptMode = 'catalog' | 'full'

export type SkillActivationSource =
  | 'default'
  | 'always'
  | 'agent'
  | 'explicit'
  | 'implicit'

export interface ImplicitSkillMatchPolicy {
  enabled: boolean
  maxMatches: number
  scoreThreshold: number
  queryTokenMinLength: number
  hintTokenMinLength: number
}

export interface SkillActivationPolicy {
  implicit: ImplicitSkillMatchPolicy
}

export interface SkillActivationInput {
  explicitSkillNames: ReadonlySet<string>
  agentSkillNames: ReadonlySet<string>
  implicitQuery?: string
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
  implicit: {
    enabled: true,
    maxMatches: 3,
    scoreThreshold: 6,
    queryTokenMinLength: 2,
    hintTokenMinLength: 3,
  },
}

interface ImplicitSkillMatch {
  score: number
  reason: string
}

/**
 * Preprocessed query — normalized text and its derived token set.
 *
 * Computed once in `resolveImplicitMatches` and threaded through the scoring
 * pipeline so every downstream function operates on the same snapshot.
 */
interface PreparedQuery {
  readonly text: string
  readonly tokens: ReadonlySet<string>
}

export function resolveSkillActivationPolicy(
  overrides?: Partial<ImplicitSkillMatchPolicy>,
): SkillActivationPolicy {
  return {
    implicit: {
      ...DEFAULT_POLICY.implicit,
      ...overrides,
    },
  }
}

export function resolveSkillActivationDecisions(
  skills: DocumentCapabilityEntry[],
  input: SkillActivationInput,
  policy: SkillActivationPolicy,
): SkillActivationDecision[] {
  const implicitMatches =
    input.explicitSkillNames.size === 0 && policy.implicit.enabled
      ? resolveImplicitMatches(skills, input.implicitQuery, policy.implicit)
      : new Map<string, ImplicitSkillMatch>()

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

    const implicit = implicitMatches.get(skill.name)
    if (implicit) {
      return {
        skillName: skill.name,
        mode: 'full',
        source: 'implicit',
        score: implicit.score,
        threshold: policy.implicit.scoreThreshold,
        reason: implicit.reason,
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

function resolveImplicitMatches(
  skills: DocumentCapabilityEntry[],
  query: string | undefined,
  policy: ImplicitSkillMatchPolicy,
): Map<string, ImplicitSkillMatch> {
  const prepared = prepareQuery(query, policy.queryTokenMinLength)
  if (!prepared) return new Map()

  const scored = skills
    .map((skill) => {
      const match = scoreImplicitSkillMatch(skill, prepared, policy)
      return {
        skillName: skill.name,
        score: match.score,
        reason: match.reason,
      }
    })
    .filter((item) => item.score >= policy.scoreThreshold)
    .sort((a, b) => (b.score - a.score) || a.skillName.localeCompare(b.skillName))
    .slice(0, policy.maxMatches)

  return new Map(
    scored.map((item) => [
      item.skillName,
      { score: item.score, reason: item.reason },
    ]),
  )
}

function prepareQuery(raw: string | undefined, tokenMinLength: number): PreparedQuery | null {
  const text = normalizeMatchText(raw)
  if (!text) return null
  const tokens = tokenize(text, tokenMinLength)
  if (tokens.size === 0) return null
  return { text, tokens }
}

// ── Implicit name scoring ─────────────────────────────────────────────────────
//
// A skill can be referenced by multiple names:
//   - its internal name  (e.g. "evose:x_analyst_ja4t9n")
//   - its aliases         (e.g. ["X Analyst"])
//
// The scorer evaluates each candidate name **independently** (phrase hit + token
// coverage) and keeps the best. This avoids token-set dilution when merging
// names with different cardinalities.

function scoreImplicitSkillMatch(
  skill: DocumentCapabilityEntry,
  query: PreparedQuery,
  policy: ImplicitSkillMatchPolicy,
): { score: number; reason: string } {
  const matchNames = resolveMatchNames(skill)
  if (matchNames.length === 0) {
    return { score: 0, reason: 'empty match names' }
  }

  // Score each candidate name independently, keep the best
  let bestNameScore = 0
  let bestNameReason = 'no name signal'
  for (const name of matchNames) {
    const result = scoreNameCandidate(name, query, policy)
    if (result.score > bestNameScore) {
      bestNameScore = result.score
      bestNameReason = result.reason
    }
  }

  if (bestNameScore === 0) {
    return { score: 0, reason: bestNameReason }
  }

  // Layer hint overlap on top of the best name score
  const hintTokens = collectSkillHintTokens(skill, policy.hintTokenMinLength)
  let hintOverlap = 0
  for (const token of hintTokens) {
    if (query.tokens.has(token)) hintOverlap += 1
  }
  const totalScore = bestNameScore + Math.min(2, hintOverlap)

  return {
    score: totalScore,
    reason: `${bestNameReason}; hintHits=${hintOverlap}`,
  }
}

/**
 * Score a single name candidate against the query.
 *
 * Scoring dimensions:
 * - Phrase hit (+8): the full normalized name appears as a substring in the query
 * - Token coverage (0–4): fraction of name tokens found in query tokens
 * - Full token match bonus (+2): every name token matched
 */
function scoreNameCandidate(
  name: string,
  query: PreparedQuery,
  policy: ImplicitSkillMatchPolicy,
): { score: number; reason: string } {
  const normalized = normalizeMatchText(name)
  const tokens = tokenize(normalized, policy.queryTokenMinLength)
  if (!normalized || tokens.size === 0) {
    return { score: 0, reason: `empty tokens for "${name}"` }
  }

  const phraseHit = query.text.includes(normalized)

  let matchedTokens = 0
  for (const token of tokens) {
    if (query.tokens.has(token)) matchedTokens += 1
  }

  if (!phraseHit && matchedTokens === 0) {
    return { score: 0, reason: `no signal for "${name}"` }
  }

  let score = 0
  if (phraseHit) score += 8

  const coverage = matchedTokens / tokens.size
  score += Math.round(coverage * 4)

  if (matchedTokens === tokens.size) score += 2

  return {
    score,
    reason: `matched="${name}"; phrase=${phraseHit}; tokenHits=${matchedTokens}/${tokens.size}`,
  }
}

/**
 * Resolve all names a skill can be referenced by.
 *
 * The internal name (`skill.name`) is always included. Providers declare
 * additional human-facing names via `attributes.aliases` — for example,
 * EvoseSkillProvider adds the original app display name ("X Analyst") so
 * implicit matching can find it when users reference it in natural language.
 *
 * Returns deduplicated names (case-insensitive).
 */
function resolveMatchNames(skill: DocumentCapabilityEntry): string[] {
  const names: string[] = []
  const seen = new Set<string>()

  const add = (value: string): void => {
    const trimmed = value.trim()
    if (!trimmed) return
    const key = trimmed.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    names.push(trimmed)
  }

  add(skill.name)
  for (const alias of toStringArray(skill.attributes['aliases'])) {
    add(alias)
  }

  return names
}

// ── Hint token collection ─────────────────────────────────────────────────────

function collectSkillHintTokens(
  skill: DocumentCapabilityEntry,
  minTokenLength: number,
): Set<string> {
  const hintChunks: string[] = []
  if (skill.description) hintChunks.push(skill.description)

  const attrTags = toStringArray(skill.attributes['tags'])
  if (attrTags.length > 0) hintChunks.push(attrTags.join(' '))

  const attrKeywords = toStringArray(skill.attributes['keywords'])
  if (attrKeywords.length > 0) hintChunks.push(attrKeywords.join(' '))

  const metadataTags = toStringArray(skill.metadata['tags'])
  if (metadataTags.length > 0) hintChunks.push(metadataTags.join(' '))

  const aliases = toStringArray(skill.attributes['aliases'])
  if (aliases.length > 0) hintChunks.push(aliases.join(' '))

  return tokenize(normalizeMatchText(hintChunks.join(' ')), minTokenLength)
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function normalizeMatchText(value: string | undefined): string {
  if (!value) return ''
  return value
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(value: string, minLength: number): Set<string> {
  if (!value) return new Set()
  const tokens = value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= minLength)
  return new Set(tokens)
}
