// SPDX-License-Identifier: Apache-2.0

import { nanoid } from 'nanoid'

/**
 * Generate a unique ID for OpenCow entities.
 *
 * Uses nanoid (21 chars, URL-safe, ~149 years at 1000 IDs/sec for 1% collision).
 * All OpenCow-owned entities (Project, Issue, InboxMessage, etc.) should use this.
 * External IDs (Session UUID, Claude Code folder name) are kept as-is.
 */
export function generateId(): string {
  return nanoid()
}
