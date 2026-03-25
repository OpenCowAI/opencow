// SPDX-License-Identifier: Apache-2.0

// === Log Level ===

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export const LOG_LEVEL_VALUE: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

// === Logger Interface (unified cross-process contract) ===

export interface Logger {
  debug(message: string, ...context: unknown[]): void
  info(message: string, ...context: unknown[]): void
  warn(message: string, ...context: unknown[]): void
  error(message: string, ...context: unknown[]): void
  child(subscope: string): Logger
}

// === LogEntry (structured log entry) ===

export interface LogEntry {
  timestamp: number
  level: LogLevel
  scope: string
  message: string
  context?: unknown[]
}

// === Formatter (pure function, independently testable) ===

export function formatLogEntry(entry: LogEntry): string {
  const ts = formatTimestamp(entry.timestamp)
  const lvl = entry.level.toUpperCase().padEnd(5)
  const ctx = formatContext(entry.context)
  return `${ts} [${lvl}] [${entry.scope}]${entry.message ? ' ' + entry.message : ''}${ctx}`
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0')
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const absOff = Math.abs(offset)
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(absOff / 60))}${pad(absOff % 60)}`
  )
}

function formatContext(context?: unknown[]): string {
  if (!context || context.length === 0) return ''
  return (
    ' ' +
    context
      .map((a) => {
        if (a instanceof Error) return `${a.message}${a.stack ? '\n' + a.stack : ''}`
        // IPC-serialized Error object (from the renderer process)
        if (isSerializedError(a)) return `${a.message}${a.stack ? '\n' + a.stack : ''}`
        if (typeof a === 'object' && a !== null) {
          try {
            return JSON.stringify(a)
          } catch {
            return String(a)
          }
        }
        return String(a)
      })
      .join(' ')
  )
}

function isSerializedError(v: unknown): v is { __error: true; message: string; stack?: string } {
  return typeof v === 'object' && v !== null && '__error' in v && (v as Record<string, unknown>).__error === true
}
