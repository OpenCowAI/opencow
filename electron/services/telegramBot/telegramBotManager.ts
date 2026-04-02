// SPDX-License-Identifier: Apache-2.0

/**
 * TelegramBotManager — orchestrates the lifecycle of multiple concurrent
 * TelegramBotService instances.
 *
 * Extends BaseBotManager for shared lifecycle, config sync, status query,
 * and message routing.  Only implements the 3 abstract factory/routing methods.
 *
 * Design note: TelegramBotService has been updated to accept SessionOrigin
 * (instead of raw chatId) for releaseActivePlaceholder / notifySessionDone,
 * so the base class message routing works without overrides.
 */

import type {
  TelegramBotEntry,
  TelegramBotStatus,
  IMOrchestratorDeps,
  DataBusEvent,
} from '../../../src/shared/types'
import { BaseBotManager } from '../messaging/baseBotManager'
import type { TelegramOrigin } from '../messaging/types'
import { TelegramBotService } from './telegramBotService'
import type { IssueService } from '../issueService'
import type { ProjectService } from '../projectService'

export interface TelegramBotManagerDeps {
  dispatch: (event: DataBusEvent) => void
  /**
   * Fetch function forwarded to every TelegramBotService instance.
   * Carries proxy configuration from application settings.
   */
  fetch?: typeof globalThis.fetch
  orchestrator: IMOrchestratorDeps
  /** Issue service forwarded to every TelegramBotService instance. */
  issueService: IssueService
  /** Project service forwarded to every TelegramBotService instance. */
  projectService: ProjectService
}

export class TelegramBotManager extends BaseBotManager<
  TelegramBotEntry,
  TelegramBotService,
  TelegramBotStatus,
  TelegramOrigin
> {
  constructor(private readonly deps: TelegramBotManagerDeps) {
    super()
  }

  // ── Abstract implementations ────────────────────────────────────────────

  /**
   * Construct a TelegramBotService whose getConfig() closure reads from the
   * entries map.  This ensures hot-updatable fields (allowedUserIds,
   * defaultWorkspace) are visible on the next call without recreating
   * the service instance.
   */
  protected createService(entryId: string): TelegramBotService {
    return new TelegramBotService({
      getConfig: () => {
        const entry = this.entries.get(entryId)
        if (!entry) throw new Error(`TelegramBotManager: entry ${entryId} not found in entries map`)
        return entry
      },
      dispatch:       this.deps.dispatch,
      fetch:          this.deps.fetch,
      orchestrator:   this.deps.orchestrator,
      issueService:   this.deps.issueService,
      projectService: this.deps.projectService,
    })
  }

  protected getOriginConnectionId(origin: TelegramOrigin): string {
    return origin.botId
  }

  protected isRestartRequired(oldEntry: TelegramBotEntry, newEntry: TelegramBotEntry): boolean {
    return oldEntry.botToken !== newEntry.botToken
  }
}
