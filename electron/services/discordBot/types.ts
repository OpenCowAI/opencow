// SPDX-License-Identifier: Apache-2.0

/**
 * Discord Bot — internal types for the Discord IM adapter.
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

export interface DiscordBotEntry {
  id: string
  name: string
  enabled: boolean
  botToken: string
  guildId?: string
  allowedUserIds: string[]       // Discord user ID list
  defaultWorkspace: UserConfigurableWorkspaceInput
}

// ── Runtime status ──────────────────────────────────────────────────────────

export interface DiscordBotStatus {
  botId: string
  connectionStatus: IMConnectionStatusType
  connectedAt: number | null
  lastError: string | null
  botUsername: string | null
  messagesReceived: number
  messagesSent: number
}

// ── Settings ────────────────────────────────────────────────────────────────

export interface DiscordBotSettings {
  bots: DiscordBotEntry[]
}

// ── Dependencies ────────────────────────────────────────────────────────────

export interface DiscordBotManagerDeps {
  dispatch: (event: DataBusEvent) => void
  fetch?: typeof globalThis.fetch
  getProxyUrl?: () => string | null
  orchestrator: IMOrchestratorDeps
  issueService: IssueService
  projectService: ProjectService
}

export interface DiscordBotServiceDeps {
  dispatch: (event: DataBusEvent) => void
  getConfig: () => DiscordBotEntry
  fetch?: typeof globalThis.fetch
  getProxyUrl?: () => string | null
  orchestrator: IMOrchestratorDeps
  issueService: IssueService
  projectService: ProjectService
}
