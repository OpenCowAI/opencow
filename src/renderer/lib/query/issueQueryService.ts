// SPDX-License-Identifier: Apache-2.0

import type { IssueQueryFilter, IssueSummary } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

export interface QueryIssueSummariesInput {
  filter: IssueQueryFilter
}

const inFlightQueries = new Map<string, Promise<IssueSummary[]>>()

function normalizeArray<T extends string>(values: readonly T[] | undefined): T[] | undefined {
  if (!values || values.length === 0) return undefined
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

function normalizeIssueQueryFilter(filter: IssueQueryFilter): IssueQueryFilter {
  const normalized: IssueQueryFilter = {}

  if (filter.statuses && filter.statuses.length > 0) {
    normalized.statuses = [...new Set(filter.statuses)].sort((a, b) => a.localeCompare(b))
  }
  if (filter.priorities && filter.priorities.length > 0) {
    normalized.priorities = [...new Set(filter.priorities)].sort((a, b) => a.localeCompare(b))
  }
  normalized.labels = normalizeArray(filter.labels)
  normalized.sessionIds = normalizeArray(filter.sessionIds)
  normalized.sessionStates = normalizeArray(filter.sessionStates)

  if (filter.projectId) normalized.projectId = filter.projectId
  if (filter.search) normalized.search = filter.search
  if (typeof filter.parentIssueId !== 'undefined') normalized.parentIssueId = filter.parentIssueId

  if (typeof filter.createdAfter === 'number') normalized.createdAfter = filter.createdAfter
  if (typeof filter.createdBefore === 'number') normalized.createdBefore = filter.createdBefore
  if (typeof filter.updatedAfter === 'number') normalized.updatedAfter = filter.updatedAfter
  if (typeof filter.updatedBefore === 'number') normalized.updatedBefore = filter.updatedBefore
  if (typeof filter.hasSession === 'boolean') normalized.hasSession = filter.hasSession

  if (filter.sort) {
    normalized.sort = {
      field: filter.sort.field,
      order: filter.sort.order,
    }
  }

  return normalized
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => typeof item !== 'undefined')
    .sort(([a], [b]) => a.localeCompare(b))

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

function buildIssueQueryKey(filter: IssueQueryFilter): string {
  return stableStringify(normalizeIssueQueryFilter(filter))
}

/**
 * Query issues with single-flight de-duplication per canonical filter key.
 * Concurrent identical requests share the same Promise to avoid redundant IPC calls.
 */
export function queryIssueSummaries({ filter }: QueryIssueSummariesInput): Promise<IssueSummary[]> {
  const normalizedFilter = normalizeIssueQueryFilter(filter)
  const queryKey = buildIssueQueryKey(normalizedFilter)
  const existing = inFlightQueries.get(queryKey)
  if (existing) return existing

  const request = getAppAPI()['list-issues'](normalizedFilter)
    .finally(() => {
      inFlightQueries.delete(queryKey)
    })

  inFlightQueries.set(queryKey, request)
  return request
}
