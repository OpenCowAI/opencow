// SPDX-License-Identifier: Apache-2.0

/**
 * Centralized droppable ID definitions for the Issue DnD system.
 *
 * All special droppable identifiers and their classification logic live here,
 * so DnD components and hooks reference a single source of truth.
 */

/** The top-of-list "remove from parent" drop zone. */
export const UNPARENT_DROPPABLE_ID = '__unparent__'

/**
 * Check whether a droppable ID represents the unparent drop target.
 *
 * Previously also checked for gap drop zones between rows, but those have
 * been removed to enable react-virtuoso virtualization. Unparenting is now
 * handled exclusively by the single UnparentDropZone at the top of the list.
 */
export function isUnparentDroppable(id: string): boolean {
  return id === UNPARENT_DROPPABLE_ID
}
