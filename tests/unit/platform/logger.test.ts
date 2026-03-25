// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initLogger, shutdownLogger, createLogger, writeLogEntry } from '../../../electron/platform/logger'
import type { LogEntry } from '@shared/logger'

describe('Logger (main process)', () => {
  let logsDir: string

  beforeEach(() => {
    logsDir = mkdtempSync(join(tmpdir(), 'opencow-log-test-'))
  })

  afterEach(() => {
    shutdownLogger()
    rmSync(logsDir, { recursive: true, force: true })
  })

  function initTestLogger(overrides: Partial<Parameters<typeof initLogger>[0]> = {}): void {
    initLogger({
      logsDir,
      level: 'debug',
      maxFileSize: 5 * 1024 * 1024,
      maxFiles: 3,
      console: false,
      ...overrides,
    })
  }

  function readLog(): string {
    return readFileSync(join(logsDir, 'opencow.log'), 'utf-8')
  }

  function logFiles(): string[] {
    return readdirSync(logsDir).filter((f) => f.startsWith('opencow')).sort()
  }

  // ── Basic writing ──

  it('writes log entries to opencow.log', () => {
    initTestLogger()
    const log = createLogger('test')
    log.info('Hello world')
    shutdownLogger()

    const content = readLog()
    expect(content).toContain('[INFO ]')
    expect(content).toContain('[test]')
    expect(content).toContain('Hello world')
  })

  it('preserves log order', () => {
    initTestLogger()
    const log = createLogger('test')
    log.info('first')
    log.info('second')
    log.info('third')
    shutdownLogger()

    const lines = readLog().trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('first')
    expect(lines[1]).toContain('second')
    expect(lines[2]).toContain('third')
  })

  // ── Level filtering ──

  it('filters out levels below configured minimum', () => {
    initTestLogger({ level: 'warn' })
    const log = createLogger('test')
    log.debug('should not appear')
    log.info('should not appear')
    log.warn('warning visible')
    log.error('error visible')
    shutdownLogger()

    const content = readLog()
    expect(content).not.toContain('should not appear')
    expect(content).toContain('warning visible')
    expect(content).toContain('error visible')
  })

  it('includes all levels when set to debug', () => {
    initTestLogger({ level: 'debug' })
    const log = createLogger('test')
    log.debug('debug msg')
    log.info('info msg')
    log.warn('warn msg')
    log.error('error msg')
    shutdownLogger()

    const content = readLog()
    expect(content).toContain('[DEBUG]')
    expect(content).toContain('[INFO ]')
    expect(content).toContain('[WARN ]')
    expect(content).toContain('[ERROR]')
  })

  // ── Child logger ──

  it('child logger uses parent:child scope', () => {
    initTestLogger()
    const parent = createLogger('SessionSource')
    const child = parent.child('cache')
    child.info('cache hit')
    shutdownLogger()

    const content = readLog()
    expect(content).toContain('[SessionSource:cache]')
    expect(content).toContain('cache hit')
  })

  // ── writeLogEntry (used by IPC handler) ──

  it('writeLogEntry writes structured entries', () => {
    initTestLogger()
    const entry: LogEntry = {
      timestamp: Date.now(),
      level: 'info',
      scope: 'renderer:Settings',
      message: 'Settings updated',
    }
    writeLogEntry(entry)
    shutdownLogger()

    const content = readLog()
    expect(content).toContain('[renderer:Settings]')
    expect(content).toContain('Settings updated')
  })

  // ── Error context ──

  it('formats Error objects with stack trace', () => {
    initTestLogger()
    const log = createLogger('test')
    log.error('Operation failed', new Error('ENOENT'))
    shutdownLogger()

    const content = readLog()
    expect(content).toContain('ENOENT')
    expect(content).toContain('Error: ENOENT')
  })

  // ── File rotation ──

  it('rotates log files when maxFileSize is exceeded', () => {
    initTestLogger({ maxFileSize: 200, maxFiles: 3 })
    const log = createLogger('test')

    // Write enough data to trigger rotation
    for (let i = 0; i < 20; i++) {
      log.info(`line-${i}-${'x'.repeat(50)}`)
    }
    shutdownLogger()

    const files = logFiles()
    // Should have opencow.log + at least one rotated file
    expect(files.length).toBeGreaterThanOrEqual(2)
    expect(files).toContain('opencow.log')
    expect(files.some((f) => f.match(/opencow\.\d.log/))).toBe(true)
  })

  it('limits rotated files to maxFiles', () => {
    initTestLogger({ maxFileSize: 100, maxFiles: 2 })
    const log = createLogger('test')

    // Write a large amount to trigger multiple rotations
    for (let i = 0; i < 50; i++) {
      log.info(`line-${i}-${'x'.repeat(80)}`)
    }
    shutdownLogger()

    const files = logFiles()
    // opencow.log + opencow.1.log + opencow.2.log = max 3 files
    expect(files.length).toBeLessThanOrEqual(3)
  })

  // ── Graceful degradation ──

  it('does not throw when logger is not initialized', () => {
    // createLogger before initLogger — should silently do nothing
    const log = createLogger('early')
    expect(() => log.info('before init')).not.toThrow()
  })

  it('console fallback when file write fails', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Use a non-writable directory
    initLogger({
      logsDir: '/nonexistent/impossible/path',
      level: 'debug',
      maxFileSize: 5 * 1024 * 1024,
      maxFiles: 3,
      console: false,
    })

    const log = createLogger('test')
    log.error('fallback test')

    // Should fall back to console output
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
    shutdownLogger()
  })
})
