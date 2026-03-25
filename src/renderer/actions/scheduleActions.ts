// SPDX-License-Identifier: Apache-2.0

/**
 * scheduleActions — Cross-store schedule coordination.
 *
 * `selectSchedule` needs to update both the scheduleStore
 * (selectedScheduleId) and the appStore (detailContext, _tabDetails).
 * This coordinator is the ONLY place that "knows" both stores.
 *
 * Pure schedule CRUD operations live in scheduleStore — consumers
 * call those directly. Only cross-store coordination lives here.
 */

import { useScheduleStore } from '@/stores/scheduleStore'
import { useAppStore } from '@/stores/appStore'
import type { DetailContext } from '@shared/types'

/**
 * Select a schedule and open its detail panel.
 *
 * - Updates selectedScheduleId in scheduleStore
 * - Updates detailContext + _tabDetails.schedule in appStore
 */
export function selectSchedule(id: string | null): void {
  useScheduleStore.getState().setSelectedScheduleId(id)

  const ctx: DetailContext | null = id ? { type: 'schedule' as const, scheduleId: id } : null
  useAppStore.setState((s) => ({
    detailContext: ctx,
    _tabDetails: { ...s._tabDetails, schedule: ctx },
  }))
}
