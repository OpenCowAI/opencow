// SPDX-License-Identifier: Apache-2.0

/**
 * Time formatting utilities.
 *
 * Shared across components that need human-friendly time display
 * (Result Cards, Issue views, Project views, etc.).
 */

/**
 * Formats an ISO 8601 timestamp as a human-friendly relative time string.
 *
 * @param iso  ISO 8601 timestamp string (e.g. "2025-03-17T10:30:00Z")
 * @returns    Relative time like "just now", "5m ago", "3h ago", "2d ago",
 *             or a formatted date for older timestamps. Empty string on invalid input.
 */
export function formatRelativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime()
    const minutes = Math.floor(diff / 60_000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d ago`
    return new Date(iso).toLocaleDateString()
  } catch {
    return ''
  }
}
