// SPDX-License-Identifier: Apache-2.0

/**
 * FeishuBotManager — orchestrates the lifecycle of multiple concurrent
 * FeishuBotService instances.
 *
 * Extends BaseBotManager for shared lifecycle, config sync, status query,
 * and message routing.  Only implements the 3 abstract factory/routing methods.
 */

import { BaseBotManager } from '../messaging/baseBotManager'
import type { FeishuOrigin } from '../messaging/types'
import type { FeishuBotEntry, FeishuBotStatus, FeishuBotManagerDeps } from './types'
import { FeishuBotService } from './feishuBotService'

export class FeishuBotManager extends BaseBotManager<
  FeishuBotEntry,
  FeishuBotService,
  FeishuBotStatus,
  FeishuOrigin
> {
  constructor(private readonly deps: FeishuBotManagerDeps) {
    super()
  }

  // ── Abstract implementations ────────────────────────────────────────────

  protected createService(entryId: string): FeishuBotService {
    return new FeishuBotService({
      getConfig: () => {
        const entry = this.entries.get(entryId)
        if (!entry) throw new Error(`FeishuBotManager: entry ${entryId} not found`)
        return entry
      },
      dispatch:       this.deps.dispatch,
      fetch:          this.deps.fetch,
      orchestrator:   this.deps.orchestrator,
      issueService:   this.deps.issueService,
      projectService: this.deps.projectService,
    })
  }

  protected getOriginConnectionId(origin: FeishuOrigin): string {
    return origin.appId
  }

  protected isRestartRequired(oldEntry: FeishuBotEntry, newEntry: FeishuBotEntry): boolean {
    return (
      oldEntry.appId !== newEntry.appId ||
      oldEntry.appSecret !== newEntry.appSecret ||
      oldEntry.domain !== newEntry.domain
    )
  }
}
