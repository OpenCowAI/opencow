// SPDX-License-Identifier: Apache-2.0

import type { DataBusEvent, TriggerEvent, Schedule } from '../../../src/shared/types'
import type { TriggerRegistry } from './triggerRegistry'
import type { ScheduleStore } from '../scheduleStore'
import { createLogger } from '../../platform/logger'

const log = createLogger('ScheduleEventListener')

export class EventListener {
  private lastTriggerTimes = new Map<string, number>()

  constructor(
    private deps: {
      registry: TriggerRegistry
      store: ScheduleStore
      onTrigger: (event: TriggerEvent) => void
    }
  ) {}

  /** Register as DataBus broadcast listener -- called for every DataBus event */
  async handleEvent(event: DataBusEvent): Promise<void> {
    try {
      const candidates = await this.deps.store.findByEventTrigger()
      if (candidates.length > 0) {
        log.debug('Evaluating event-trigger schedules', {
          eventType: event.type,
          candidateCount: candidates.length,
        })
      }
      for (const schedule of candidates) {
        this.tryMatch(schedule, event)
      }
    } catch (err) {
      log.error('Failed to process event trigger candidates', { eventType: event.type }, err)
    }
  }

  private tryMatch(schedule: Schedule, event: DataBusEvent): void {
    const config = schedule.trigger.event
    if (!config) return

    const matcher = this.deps.registry.get(config.matcherType)
    if (!matcher) {
      log.warn('Event trigger matcher not found', {
        scheduleId: schedule.id,
        matcherType: config.matcherType,
      })
      return
    }
    if (!matcher.matches(event, config.filter)) return
    if (this.isThrottled(schedule)) {
      log.debug('Event trigger throttled', {
        scheduleId: schedule.id,
        throttleMs: schedule.trigger.throttleMs ?? null,
      })
      return
    }

    this.lastTriggerTimes.set(schedule.id, Date.now())
    log.info('Event trigger matched schedule', {
      scheduleId: schedule.id,
      eventType: event.type,
      matcherType: config.matcherType,
    })
    this.deps.onTrigger({
      scheduleId: schedule.id,
      reason: 'event',
      timestamp: Date.now(),
      eventType: event.type,
    })
  }

  private isThrottled(schedule: Schedule): boolean {
    const throttle = schedule.trigger.throttleMs
    if (!throttle) return false
    const last = this.lastTriggerTimes.get(schedule.id)
    return !!last && Date.now() - last < throttle
  }
}
