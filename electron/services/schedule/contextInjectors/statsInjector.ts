// SPDX-License-Identifier: Apache-2.0

import type { ContextInjector, ContextInjectionType, Schedule, StatsSnapshot } from '../../../../src/shared/types'

interface StatsProviderLike {
  getLatest(): StatsSnapshot | null
}

export class StatsInjector implements ContextInjector {
  readonly type: ContextInjectionType = 'today_stats'

  constructor(private statsProvider: StatsProviderLike) {}

  async inject(_schedule: Schedule): Promise<string> {
    const stats = this.statsProvider.getLatest()
    if (!stats) return '[Stats not available]'

    return [
      `**Today's stats:**`,
      `- Cost: $${stats.todayCostUSD.toFixed(4)}`,
      `- Tokens: ${stats.todayTokens.toLocaleString()}`,
      `- Sessions: ${stats.todaySessions}`,
      `- Tool calls: ${stats.todayToolCalls}`,
    ].join('\n')
  }
}
