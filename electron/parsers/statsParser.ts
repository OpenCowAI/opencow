// SPDX-License-Identifier: Apache-2.0

import type { StatsSnapshot } from '@shared/types'

const ZERO_SNAPSHOT: StatsSnapshot = {
  todayCostUSD: 0,
  todayTokens: 0,
  todaySessions: 0,
  todayToolCalls: 0,
  totalSessions: 0,
  totalMessages: 0
}

interface DailyActivity {
  date: string
  sessionCount: number
  toolCallCount: number
}

interface DailyModelTokens {
  date: string
  tokensByModel: Record<string, number>
}

interface RawStatsCache {
  totalSessions?: number
  totalMessages?: number
  totalCost?: number
  totalTokens?: number
  dailyActivity?: DailyActivity[]
  dailyModelTokens?: DailyModelTokens[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function num(value: unknown, fallback: number = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Parses the raw JSON content of ~/.claude/stats-cache.json and extracts
 * a daily snapshot for the given date.
 *
 * Handles malformed data gracefully — returns zeros for missing fields, never throws.
 */
export function parseStatsSnapshot(raw: unknown, today: string): StatsSnapshot {
  if (!isRecord(raw)) {
    return { ...ZERO_SNAPSHOT }
  }

  const data = raw as RawStatsCache

  const totalSessions = num(data.totalSessions)
  const totalMessages = num(data.totalMessages)
  const totalCost = num(data.totalCost)
  const totalTokens = num(data.totalTokens)

  // Find today's daily activity
  const dailyActivity = Array.isArray(data.dailyActivity) ? data.dailyActivity : []
  const todayActivity = dailyActivity.find(
    (entry) => isRecord(entry) && entry.date === today
  ) as DailyActivity | undefined

  const todaySessions = num(todayActivity?.sessionCount)
  const todayToolCalls = num(todayActivity?.toolCallCount)

  // Sum today's tokens across all models
  const dailyModelTokens = Array.isArray(data.dailyModelTokens) ? data.dailyModelTokens : []
  const todayModelTokens = dailyModelTokens.find(
    (entry) => isRecord(entry) && entry.date === today
  ) as DailyModelTokens | undefined

  let todayTokens = 0
  if (todayModelTokens && isRecord(todayModelTokens.tokensByModel)) {
    for (const count of Object.values(todayModelTokens.tokensByModel)) {
      todayTokens += num(count)
    }
  }

  // Estimate today's cost from token ratio
  let todayCostUSD = 0
  if (totalTokens > 0 && todayTokens > 0) {
    const costPerToken = totalCost / totalTokens
    todayCostUSD = todayTokens * costPerToken
  }

  return {
    todayCostUSD,
    todayTokens,
    todaySessions,
    todayToolCalls,
    totalSessions,
    totalMessages
  }
}
