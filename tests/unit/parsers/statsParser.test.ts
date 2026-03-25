// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { parseStatsSnapshot } from '../../../electron/parsers/statsParser'
import type { StatsSnapshot } from '@shared/types'

const ZERO_SNAPSHOT: StatsSnapshot = {
  todayCostUSD: 0,
  todayTokens: 0,
  todaySessions: 0,
  todayToolCalls: 0,
  totalSessions: 0,
  totalMessages: 0
}

describe('statsParser', () => {
  describe('parseStatsSnapshot', () => {
    it('computes today snapshot from full stats-cache data', () => {
      const raw = {
        totalSessions: 42,
        totalMessages: 500,
        totalCost: 10.0,
        totalTokens: 1_000_000,
        dailyActivity: [
          { date: '2026-02-22', sessionCount: 5, toolCallCount: 30 },
          { date: '2026-02-21', sessionCount: 3, toolCallCount: 20 }
        ],
        dailyModelTokens: [
          {
            date: '2026-02-22',
            tokensByModel: { 'claude-opus-4': 50000, 'claude-sonnet-4': 30000 }
          },
          {
            date: '2026-02-21',
            tokensByModel: { 'claude-opus-4': 40000 }
          }
        ]
      }

      const result = parseStatsSnapshot(raw, '2026-02-22')

      expect(result.todaySessions).toBe(5)
      expect(result.todayToolCalls).toBe(30)
      expect(result.todayTokens).toBe(80000) // 50000 + 30000
      expect(result.totalSessions).toBe(42)
      expect(result.totalMessages).toBe(500)
    })

    it('computes todayCostUSD estimation from token ratio', () => {
      const raw = {
        totalSessions: 10,
        totalMessages: 100,
        totalCost: 5.0,
        totalTokens: 500_000,
        dailyActivity: [
          { date: '2026-02-22', sessionCount: 2, toolCallCount: 10 }
        ],
        dailyModelTokens: [
          {
            date: '2026-02-22',
            tokensByModel: { 'claude-opus-4': 100_000 }
          }
        ]
      }

      const result = parseStatsSnapshot(raw, '2026-02-22')

      // costPerToken = 5.0 / 500_000 = 0.00001
      // todayCost = 100_000 * 0.00001 = 1.0
      expect(result.todayCostUSD).toBeCloseTo(1.0, 5)
    })

    it('returns zero cost when totalTokens is 0', () => {
      const raw = {
        totalSessions: 0,
        totalMessages: 0,
        totalCost: 0,
        totalTokens: 0,
        dailyActivity: [
          { date: '2026-02-22', sessionCount: 1, toolCallCount: 5 }
        ],
        dailyModelTokens: [
          {
            date: '2026-02-22',
            tokensByModel: { 'claude-opus-4': 1000 }
          }
        ]
      }

      const result = parseStatsSnapshot(raw, '2026-02-22')
      expect(result.todayCostUSD).toBe(0)
    })

    it('returns zero snapshot when no data for today', () => {
      const raw = {
        totalSessions: 10,
        totalMessages: 100,
        totalCost: 5.0,
        totalTokens: 500_000,
        dailyActivity: [
          { date: '2026-02-21', sessionCount: 3, toolCallCount: 20 }
        ],
        dailyModelTokens: [
          {
            date: '2026-02-21',
            tokensByModel: { 'claude-opus-4': 40000 }
          }
        ]
      }

      const result = parseStatsSnapshot(raw, '2026-02-22')

      expect(result.todaySessions).toBe(0)
      expect(result.todayToolCalls).toBe(0)
      expect(result.todayTokens).toBe(0)
      expect(result.todayCostUSD).toBe(0)
      // totals still come through
      expect(result.totalSessions).toBe(10)
      expect(result.totalMessages).toBe(100)
    })

    it('handles malformed data gracefully - null input', () => {
      expect(parseStatsSnapshot(null, '2026-02-22')).toEqual(ZERO_SNAPSHOT)
    })

    it('handles malformed data gracefully - undefined input', () => {
      expect(parseStatsSnapshot(undefined, '2026-02-22')).toEqual(ZERO_SNAPSHOT)
    })

    it('handles malformed data gracefully - empty object', () => {
      expect(parseStatsSnapshot({}, '2026-02-22')).toEqual(ZERO_SNAPSHOT)
    })

    it('handles malformed data gracefully - non-object input', () => {
      expect(parseStatsSnapshot('not an object', '2026-02-22')).toEqual(ZERO_SNAPSHOT)
      expect(parseStatsSnapshot(42, '2026-02-22')).toEqual(ZERO_SNAPSHOT)
      expect(parseStatsSnapshot(true, '2026-02-22')).toEqual(ZERO_SNAPSHOT)
    })

    it('handles missing dailyActivity array gracefully', () => {
      const raw = {
        totalSessions: 5,
        totalMessages: 50,
        totalCost: 2.0,
        totalTokens: 200_000,
        dailyModelTokens: [
          {
            date: '2026-02-22',
            tokensByModel: { 'claude-opus-4': 10000 }
          }
        ]
      }

      const result = parseStatsSnapshot(raw, '2026-02-22')
      expect(result.todaySessions).toBe(0)
      expect(result.todayToolCalls).toBe(0)
      expect(result.todayTokens).toBe(10000)
      expect(result.totalSessions).toBe(5)
    })

    it('handles missing dailyModelTokens array gracefully', () => {
      const raw = {
        totalSessions: 5,
        totalMessages: 50,
        totalCost: 2.0,
        totalTokens: 200_000,
        dailyActivity: [
          { date: '2026-02-22', sessionCount: 3, toolCallCount: 15 }
        ]
      }

      const result = parseStatsSnapshot(raw, '2026-02-22')
      expect(result.todaySessions).toBe(3)
      expect(result.todayToolCalls).toBe(15)
      expect(result.todayTokens).toBe(0)
      expect(result.todayCostUSD).toBe(0)
    })

    it('handles dailyModelTokens with empty tokensByModel', () => {
      const raw = {
        totalSessions: 5,
        totalMessages: 50,
        totalCost: 2.0,
        totalTokens: 200_000,
        dailyActivity: [],
        dailyModelTokens: [
          { date: '2026-02-22', tokensByModel: {} }
        ]
      }

      const result = parseStatsSnapshot(raw, '2026-02-22')
      expect(result.todayTokens).toBe(0)
    })
  })
})
