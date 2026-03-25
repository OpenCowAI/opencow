// SPDX-License-Identifier: Apache-2.0

import type { ManagedCapabilityCategory, CapabilityDiagnostic } from '@shared/types'

// ─── Constants ──────────────────────────────────────────────────────────

/** Maximum number of diagnostic entries to retain (FIFO eviction). */
const MAX_ENTRIES = 1_000

/**
 * Collects diagnostic info during capability discovery and operations.
 *
 * Used by ImportPipeline, DiscoveryEngine, and CapabilityCenter facade
 * to accumulate warnings/errors that are surfaced in the UI.
 *
 * Quality review fixes:
 *   - flush() returns a defensive copy (prevents caller mutation of internals)
 *   - FIFO eviction when MAX_ENTRIES is exceeded
 *   - timestamp added to each entry for chronological debugging
 */
export class DiagnosticsCollector {
  private entries: CapabilityDiagnostic[] = []

  info(category: ManagedCapabilityCategory, message: string, name?: string): void {
    this.push({ level: 'info', category, name, message, timestamp: Date.now() })
  }

  warn(category: ManagedCapabilityCategory, message: string, name?: string): void {
    this.push({ level: 'warn', category, name, message, timestamp: Date.now() })
  }

  error(category: ManagedCapabilityCategory, message: string, name?: string): void {
    this.push({ level: 'error', category, name, message, timestamp: Date.now() })
  }

  /** Drain all collected entries and reset. Returns a defensive copy. */
  flush(): CapabilityDiagnostic[] {
    const result = [...this.entries]
    this.entries = []
    return result
  }

  /** Peek at current entries without flushing */
  peek(): readonly CapabilityDiagnostic[] {
    return this.entries
  }

  /** Count of entries at a given level */
  count(level?: CapabilityDiagnostic['level']): number {
    if (!level) return this.entries.length
    return this.entries.filter((e) => e.level === level).length
  }

  // ── Internal ────────────────────────────────────────────────────────

  private push(entry: CapabilityDiagnostic): void {
    this.entries.push(entry)
    // FIFO eviction: drop oldest entries when over limit
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES)
    }
  }
}
