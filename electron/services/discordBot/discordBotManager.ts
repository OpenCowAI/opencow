// SPDX-License-Identifier: Apache-2.0

/**
 * DiscordBotManager — orchestrates the lifecycle of multiple concurrent
 * DiscordBotService instances.
 *
 * Extends BaseBotManager for shared lifecycle, config sync, status query,
 * and message routing.  Only implements the 3 abstract factory/routing methods.
 */

import { BaseBotManager } from '../messaging/baseBotManager'
import type { DiscordOrigin } from '../messaging/types'
import type { DiscordBotEntry, DiscordBotStatus, DiscordBotManagerDeps } from './types'
import { DiscordBotService } from './discordBotService'

export class DiscordBotManager extends BaseBotManager<
  DiscordBotEntry,
  DiscordBotService,
  DiscordBotStatus,
  DiscordOrigin
> {
  constructor(private readonly deps: DiscordBotManagerDeps) {
    super()
  }

  // ── Abstract implementations ────────────────────────────────────────────

  protected createService(entryId: string): DiscordBotService {
    return new DiscordBotService({
      getConfig: () => {
        const entry = this.entries.get(entryId)
        if (!entry) throw new Error(`DiscordBotManager: entry ${entryId} not found`)
        return entry
      },
      dispatch:       this.deps.dispatch,
      fetch:          this.deps.fetch,
      getProxyUrl:    this.deps.getProxyUrl,
      orchestrator:   this.deps.orchestrator,
      issueService:   this.deps.issueService,
      projectService: this.deps.projectService,
    })
  }

  protected getOriginConnectionId(origin: DiscordOrigin): string {
    return origin.botId
  }

  protected isRestartRequired(oldEntry: DiscordBotEntry, newEntry: DiscordBotEntry): boolean {
    return oldEntry.botToken !== newEntry.botToken
  }
}
