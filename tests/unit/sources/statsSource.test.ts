// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFile, mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import type { DataBusEvent, StatsSnapshot } from '@shared/types'

// We need to mock the STATS_FILE path before importing StatsSource.
// Use vi.hoisted to create mock values that can be used in vi.mock.
const mocks = vi.hoisted(() => {
  let statsFilePath = ''
  return {
    getStatsFilePath: () => statsFilePath,
    setStatsFilePath: (p: string) => {
      statsFilePath = p
    }
  }
})

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    watchFile: vi.fn(),
    unwatchFile: vi.fn()
  }
})

describe('StatsSource', () => {
  let tempDir: string
  let dispatched: DataBusEvent[]
  let dispatch: (event: DataBusEvent) => void

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'opencow-stats-'))
    dispatched = []
    dispatch = (event: DataBusEvent) => {
      dispatched.push(event)
    }
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('parses stats-cache.json and dispatches stats:updated with correct payload', async () => {
    const statsFile = join(tempDir, 'stats-cache.json')
    const rawData = {
      totalSessions: 42,
      totalMessages: 500,
      totalCost: 10.0,
      totalTokens: 1_000_000,
      dailyActivity: [
        { date: new Date().toISOString().slice(0, 10), sessionCount: 5, toolCallCount: 30 }
      ],
      dailyModelTokens: [
        {
          date: new Date().toISOString().slice(0, 10),
          tokensByModel: { 'claude-opus-4': 50000, 'claude-sonnet-4': 30000 }
        }
      ]
    }
    await writeFile(statsFile, JSON.stringify(rawData))

    // Import the module and use it with the temp file
    const { StatsSource } = await import('../../../electron/sources/statsSource')
    const source = new StatsSource(dispatch, statsFile)
    await source.scan()

    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].type).toBe('stats:updated')

    const payload = dispatched[0].payload as StatsSnapshot
    expect(payload.totalSessions).toBe(42)
    expect(payload.totalMessages).toBe(500)
    expect(payload.todaySessions).toBe(5)
    expect(payload.todayToolCalls).toBe(30)
    expect(payload.todayTokens).toBe(80000) // 50000 + 30000
  })

  it('does not dispatch when file does not exist', async () => {
    const nonExistentFile = join(tempDir, 'nonexistent', 'stats-cache.json')

    const { StatsSource } = await import('../../../electron/sources/statsSource')
    const source = new StatsSource(dispatch, nonExistentFile)
    await source.scan()

    expect(dispatched).toHaveLength(0)
  })

  it('does not dispatch when file content is invalid JSON', async () => {
    const statsFile = join(tempDir, 'stats-cache.json')
    await writeFile(statsFile, 'this is not valid json {{{')

    const { StatsSource } = await import('../../../electron/sources/statsSource')
    const source = new StatsSource(dispatch, statsFile)
    await source.scan()

    expect(dispatched).toHaveLength(0)
  })

  it('dispatches a zero-like snapshot for empty JSON object', async () => {
    const statsFile = join(tempDir, 'stats-cache.json')
    await writeFile(statsFile, '{}')

    const { StatsSource } = await import('../../../electron/sources/statsSource')
    const source = new StatsSource(dispatch, statsFile)
    await source.scan()

    expect(dispatched).toHaveLength(1)
    const payload = dispatched[0].payload as StatsSnapshot
    expect(payload.totalSessions).toBe(0)
    expect(payload.totalMessages).toBe(0)
    expect(payload.todaySessions).toBe(0)
    expect(payload.todayTokens).toBe(0)
  })

  it('stop calls unwatchFile', async () => {
    const { unwatchFile } = await import('fs')
    const statsFile = join(tempDir, 'stats-cache.json')

    const { StatsSource } = await import('../../../electron/sources/statsSource')
    const source = new StatsSource(dispatch, statsFile)
    source.stop()

    expect(unwatchFile).toHaveBeenCalledWith(statsFile)
  })
})
