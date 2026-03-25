// SPDX-License-Identifier: Apache-2.0

import type { ManagedSessionMessage } from '@shared/types'
import { extractAllArtifacts, isSupportedArtifact } from '@shared/artifactExtraction'
import type { ExtractedArtifact } from '@shared/artifactExtraction'

// ─── Types ───────────────────────────────────────────────────────────────────

/** Which tab is active in the SessionPanel console area */
export type SessionPanelTab = 'console' | 'artifacts' | 'notes'

// Re-export for consumers that need the canonical artifact shape
export type { ExtractedArtifact }

// ─── Extraction ──────────────────────────────────────────────────────────────

/**
 * Extract session artifacts for the Artifacts tab: `.md` files + mermaid diagrams.
 *
 * Returns a unified `ExtractedArtifact[]` sorted by lastModifiedAt descending.
 * Uses the shared `isSupportedArtifact` predicate to stay aligned with the
 * persistence layer (ArtifactService).
 */
export function extractSessionArtifacts(messages: ManagedSessionMessage[]): ExtractedArtifact[] {
  return extractAllArtifacts(messages).filter(isSupportedArtifact)
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

/**
 * Format a timestamp as a human-readable relative time string.
 * Examples: "just now", "2m ago", "1h ago", "3d ago"
 */
export function formatRelativeTime(timestampMs: number): string {
  const diffSec = Math.floor((Date.now() - timestampMs) / 1000)
  if (diffSec < 10) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const min = Math.floor(diffSec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  return `${days}d ago`
}
