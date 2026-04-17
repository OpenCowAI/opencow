// SPDX-License-Identifier: Apache-2.0

/**
 * scheduleDraftMapper — Shared mappers for schedule draft outputs.
 *
 * Phase A extracts ParsedScheduleOutput mapping out of UI components so both
 * creator modals and in-session draft flows can reuse identical conversion logic.
 *
 * @module
 */

import type { CreateScheduleInput } from '@shared/types'
import type { ParsedScheduleOutput } from '@shared/scheduleOutputParser'
import type { ScheduleFormDefaultValues } from '@/components/ScheduleView/ScheduleFormModal/useScheduleForm'

/** ParsedScheduleOutput → ScheduleFormDefaultValues (edit flow). */
export function mapScheduleDraftToFormDefaults(
  parsed: ParsedScheduleOutput,
  projectId?: string | null
): ScheduleFormDefaultValues {
  return {
    name: parsed.name,
    description: parsed.description,
    projectId: projectId ?? null,
    triggerMode: 'time',
    timeTrigger: {
      freqType: parsed.frequency,
      timeOfDay: parsed.timeOfDay ?? '09:00',
      intervalMinutes: parsed.intervalMinutes ?? 60,
      daysOfWeek: parsed.daysOfWeek ?? [1, 2, 3, 4, 5],
      cronExpression: parsed.cronExpression ?? '',
      executeAt: parsed.executeAt ?? '',
    },
    action: {
      type: 'start_session',
      promptTemplate: parsed.prompt,
      systemPrompt: parsed.systemPrompt,
    },
  }
}

/** ParsedScheduleOutput → CreateScheduleInput (direct create flow). */
export function mapScheduleDraftToCreateInput(
  parsed: ParsedScheduleOutput,
  projectId?: string | null
): CreateScheduleInput {
  return {
    name: parsed.name,
    description: parsed.description || undefined,
    trigger: {
      time: {
        type: parsed.frequency,
        workMode: 'all_days',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timeOfDay: parsed.timeOfDay,
        intervalMinutes: parsed.intervalMinutes,
        daysOfWeek: parsed.daysOfWeek,
        cronExpression: parsed.cronExpression,
        executeAt: parsed.executeAt ? new Date(parsed.executeAt).getTime() : undefined,
      },
    },
    action: {
      type: 'start_session',
      session: {
        promptTemplate: parsed.prompt,
        systemPrompt: parsed.systemPrompt,
      },
      projectId: projectId ?? undefined,
    },
    priority: parsed.priority || 'normal',
  }
}
