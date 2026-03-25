// SPDX-License-Identifier: Apache-2.0

import { openSync, writeSync, closeSync, statSync, renameSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { LOG_LEVEL_VALUE, formatLogEntry } from '@shared/logger'
import type { LogLevel, Logger, LogEntry } from '@shared/logger'

// === Config ===

export interface LoggerConfig {
  /** Log file directory */
  logsDir: string
  /** Minimum log level (dev default: debug, prod default: info) */
  level: LogLevel
  /** Maximum size of a single log file in bytes (default: 5MB) */
  maxFileSize: number
  /** Number of rotated files to keep (default: 3) */
  maxFiles: number
  /** Also output to console (dev default: true, prod default: false) */
  console: boolean
}

// === FileTransport (synchronous write + size-based rotation) ===

class FileTransport {
  private fd: number | null = null
  private currentSize = 0
  private degraded = false
  private readonly filePath: string
  private readonly maxSize: number
  private readonly maxFiles: number

  constructor(config: { logsDir: string; maxFileSize: number; maxFiles: number }) {
    this.filePath = join(config.logsDir, 'opencow.log')
    this.maxSize = config.maxFileSize
    this.maxFiles = config.maxFiles
    try {
      mkdirSync(config.logsDir, { recursive: true })
    } catch {
      // Directory creation failed — open() will also fail and set degraded mode
      this.degraded = true
      console.error(`[Logger] Failed to create logs directory: ${config.logsDir}`)
    }
    this.open()
  }

  /**
   * Write a formatted log line to the file.
   * Returns true on success, false on failure (caller should fall back to console).
   */
  write(line: string): boolean {
    // Self-heal: if previous open failed, try again on each write
    if (this.fd === null) {
      this.open()
      if (this.fd === null) return false
    }

    try {
      const buf = line + '\n'
      writeSync(this.fd, buf)
      this.currentSize += Buffer.byteLength(buf)
      if (this.currentSize >= this.maxSize) {
        this.rotate()
      }
      if (this.degraded) {
        this.degraded = false
      }
      return true
    } catch {
      if (!this.degraded) {
        this.degraded = true
        console.error(`[Logger] File write failed, falling back to console output`)
      }
      return false
    }
  }

  close(): void {
    if (this.fd !== null) {
      try {
        closeSync(this.fd)
      } catch {
        /* shutdown best-effort */
      }
      this.fd = null
    }
  }

  private open(): void {
    try {
      this.fd = openSync(this.filePath, 'a')
      try {
        this.currentSize = statSync(this.filePath).size
      } catch {
        this.currentSize = 0
      }
      this.degraded = false
    } catch {
      this.fd = null
      if (!this.degraded) {
        this.degraded = true
        console.error(`[Logger] Failed to open log file: ${this.filePath}`)
      }
    }
  }

  private rotate(): void {
    this.close()
    // Shift from oldest: opencow.3.log ← opencow.2.log ← opencow.1.log ← opencow.log
    for (let i = this.maxFiles; i >= 1; i--) {
      const from =
        i === 1 ? this.filePath : join(dirname(this.filePath), `opencow.${i - 1}.log`)
      const to = join(dirname(this.filePath), `opencow.${i}.log`)
      try {
        renameSync(from, to)
      } catch {
        /* source doesn't exist — skip */
      }
    }
    this.open()
  }
}

// === Module-level singleton ===

let fileTransport: FileTransport | null = null
let loggerConfig: LoggerConfig | null = null

/**
 * Initialise the logging system. MUST be called once in main.ts
 * before any service starts logging.
 *
 * Safe to call before `createLogger` — loggers created before init
 * will start working once this is called (closures read config at call time).
 */
export function initLogger(config: LoggerConfig): void {
  if (fileTransport) fileTransport.close()
  loggerConfig = config
  fileTransport = new FileTransport({
    logsDir: config.logsDir,
    maxFileSize: config.maxFileSize,
    maxFiles: config.maxFiles,
  })
}

/**
 * Gracefully shut down the logging system.
 * Called during the app quit sequence, after all services have stopped.
 */
export function shutdownLogger(): void {
  if (fileTransport) {
    fileTransport.close()
    fileTransport = null
  }
}

/**
 * Write a structured log entry to file (and optionally console).
 *
 * Used by both main-process loggers and the IPC `log:write` handler
 * (for renderer-originated logs).
 */
export function writeLogEntry(entry: LogEntry): void {
  if (!loggerConfig) return
  if (LOG_LEVEL_VALUE[entry.level] < LOG_LEVEL_VALUE[loggerConfig.level]) return

  const line = formatLogEntry(entry)
  const written = fileTransport?.write(line) ?? false

  // Graceful degradation: console output when file write fails, or in console mode
  if (!written || loggerConfig.console) {
    const fn =
      entry.level === 'error'
        ? console.error
        : entry.level === 'warn'
          ? console.warn
          : console.log
    fn(line)
  }
}

/**
 * Create a scoped Logger for a module.
 *
 * The returned logger reads config at call time (not creation time),
 * so it's safe to create loggers at module level before `initLogger`.
 *
 * @example
 * const log = createLogger('SessionSource')
 * log.info('Scan completed', { sessions: 42 })
 * log.error('Scan failed', err)
 * log.child('cache').debug('Cache hit')
 */
export function createLogger(scope: string): Logger {
  function log(level: LogLevel, message: string, context: unknown[]): void {
    writeLogEntry({
      timestamp: Date.now(),
      level,
      scope,
      message,
      context: context.length > 0 ? context : undefined,
    })
  }

  return {
    debug: (msg, ...ctx) => log('debug', msg, ctx),
    info: (msg, ...ctx) => log('info', msg, ctx),
    warn: (msg, ...ctx) => log('warn', msg, ctx),
    error: (msg, ...ctx) => log('error', msg, ctx),
    child: (subscope) => createLogger(`${scope}:${subscope}`),
  }
}
