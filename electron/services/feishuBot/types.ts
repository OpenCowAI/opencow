// SPDX-License-Identifier: Apache-2.0

/**
 * Feishu Bot — internal types for the Feishu/Lark IM adapter.
 */

import type {
  IMConnectionStatusType,
  IMOrchestratorDeps,
  DataBusEvent,
  UserConfigurableWorkspaceInput,
} from '../../../src/shared/types'
import type { IssueService } from '../issueService'
import type { ProjectService } from '../projectService'

// ── Internal configuration ──────────────────────────────────────────────────

export interface FeishuBotEntry {
  id: string
  name: string
  enabled: boolean
  /** API domain — 'feishu' for China (open.feishu.cn), 'lark' for International (open.larksuite.com). */
  domain: 'feishu' | 'lark'
  appId: string
  appSecret: string
  allowedUserIds: string[]       // open_id list
  defaultWorkspace: UserConfigurableWorkspaceInput
}

// ── Runtime status ──────────────────────────────────────────────────────────

export interface FeishuBotStatus {
  botId: string
  connectionStatus: IMConnectionStatusType
  connectedAt: number | null
  lastError: string | null
  botName: string | null
  messagesReceived: number
  messagesSent: number
}

// ── Settings ────────────────────────────────────────────────────────────────

export interface FeishuBotSettings {
  bots: FeishuBotEntry[]
}

// ── Dependencies ────────────────────────────────────────────────────────────

export interface FeishuBotManagerDeps {
  dispatch: (event: DataBusEvent) => void
  fetch?: typeof globalThis.fetch
  orchestrator: IMOrchestratorDeps
  issueService: IssueService
  projectService: ProjectService
}

export interface FeishuBotServiceDeps {
  dispatch: (event: DataBusEvent) => void
  getConfig: () => FeishuBotEntry
  fetch?: typeof globalThis.fetch
  orchestrator: IMOrchestratorDeps
  issueService: IssueService
  projectService: ProjectService
}
