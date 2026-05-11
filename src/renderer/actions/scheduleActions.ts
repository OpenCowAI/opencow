// SPDX-License-Identifier: Apache-2.0

/**
 * scheduleActions — Cross-store schedule coordination.
 *
 * Plain navigation lives on `useAppStore.navigateToSchedule`. This module
 * adds the deselect variant (passing `null`) used by the inbox and search
 * surfaces; the appStore action only handles "open a specific schedule"
 * because that's the path that needs cross-project routing.
 *
 * Pure schedule CRUD operations live in scheduleStore — call those
 * directly. Only cross-store coordination lives here.
 */

import { useScheduleStore } from '@/stores/scheduleStore'
import { useAppStore } from '@/stores/appStore'

/**
 * Select a schedule (`id`), or clear the current selection (`null`).
 *
 * Selecting routes the user to the schedule tab (in the owning project)
 * and opens the inline detail view. Clearing closes the detail and drops
 * `selectedScheduleId` from the schedule store.
 */
export function selectSchedule(id: string | null): void {
  if (id) {
    useAppStore.getState().navigateToSchedule(id)
    return
  }
  useScheduleStore.getState().setSelectedScheduleId(null)
  useAppStore.getState().closeDetail()
}
