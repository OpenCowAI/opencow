// SPDX-License-Identifier: Apache-2.0

import type { TriggerMatcher } from '../../../src/shared/types'
import { createLogger } from '../../platform/logger'

const log = createLogger('ScheduleTriggerRegistry')

export class TriggerRegistry {
  private matchers = new Map<string, TriggerMatcher>()

  register(matcher: TriggerMatcher): void {
    this.matchers.set(matcher.type, matcher)
    log.info('Trigger matcher registered', { matcherType: matcher.type, total: this.matchers.size })
  }

  get(type: string): TriggerMatcher | undefined {
    return this.matchers.get(type)
  }

  getAll(): TriggerMatcher[] {
    return Array.from(this.matchers.values())
  }
}
