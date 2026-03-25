// SPDX-License-Identifier: Apache-2.0

/**
 * Session error classification utilities.
 *
 * Ideally the backend would propagate a structured error category
 * (e.g. `process_corrupted | transient`) so the UI wouldn't need to parse
 * strings. Until that plumbing exists, we centralise the detection here to
 * avoid scattering regex heuristics across components.
 */

/**
 * Whether an error message indicates a process-level corruption (e.g. EBADF
 * file-descriptor leak) that **cannot** be recovered within the current
 * application lifecycle — the only valid remediation is a full app restart.
 */
export function isProcessCorruptedError(error: string): boolean {
  return /EBADF|process failed/.test(error)
}
