// SPDX-License-Identifier: Apache-2.0

import type { ManagedSessionTable } from '../../database/types'
import type {
  ManagedSessionInfo,
  ManagedSessionMessage,
  SessionExecutionContext,
  SessionOrigin,
} from '../../../src/shared/types'
import {
  asProviderProfileId,
  type ProviderProfileId,
} from '../../../src/shared/providerProfile'

function parseEngineState(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // ignored — caller falls back to defaults
  }
  return null
}

function rowToOrigin(source: string, id: string | null, extra: string | null): SessionOrigin {
  switch (source) {
    case 'issue':
      return { source: 'issue', issueId: id ?? '' }
    case 'telegram':
      return { source: 'telegram', chatId: id ?? '', botId: extra ?? 'default' }
    case 'feishu':
      return { source: 'feishu', chatId: id ?? '', appId: extra ?? '' }
    case 'discord':
      return { source: 'discord', channelId: id ?? '', botId: extra ?? '' }
    case 'weixin':
      return { source: 'weixin', userId: id ?? '', connectionId: extra ?? '' }
    case 'schedule':
      return { source: 'schedule', scheduleId: id ?? '' }
    case 'hook':
      return { source: 'hook', webhookId: id ?? '' }
    case 'browser-agent':
      return { source: 'browser-agent' }
    case 'skill-creator':
      return { source: 'skill-creator' }
    case 'agent-creator':
      return { source: 'agent-creator' }
    case 'command-creator':
      return { source: 'command-creator' }
    case 'rule-creator':
      return { source: 'rule-creator' }
    case 'issue-creator':
      return { source: 'issue-creator' }
    case 'schedule-creator':
      return { source: 'schedule-creator' }
    case 'bot-creator':
      return { source: 'bot-creator' }
    case 'market-analyzer':
      return { source: 'market-analyzer', slug: id ?? '', marketplaceId: extra ?? '' }
    case 'review': {
      const payload = parseJsonObject(extra)
      const turnAnchorMessageId = payload?.turnAnchorMessageId
      return {
        source: 'review',
        issueId: id ?? '',
        sessionId: typeof payload?.sessionId === 'string' ? payload.sessionId : '',
        turnAnchorMessageId:
          typeof turnAnchorMessageId === 'string' ? turnAnchorMessageId : undefined,
      }
    }
    default:
      return { source: 'agent' }
  }
}

function originToColumns(origin: SessionOrigin): {
  origin_source: string
  origin_id: string | null
  origin_extra: string | null
} {
  switch (origin.source) {
    case 'issue':
      return { origin_source: 'issue', origin_id: origin.issueId, origin_extra: null }
    case 'telegram':
      return { origin_source: 'telegram', origin_id: origin.chatId, origin_extra: origin.botId }
    case 'feishu':
      return { origin_source: 'feishu', origin_id: origin.chatId, origin_extra: origin.appId }
    case 'discord':
      return { origin_source: 'discord', origin_id: origin.channelId, origin_extra: origin.botId }
    case 'weixin':
      return { origin_source: 'weixin', origin_id: origin.userId, origin_extra: origin.connectionId }
    case 'schedule':
      return { origin_source: 'schedule', origin_id: origin.scheduleId, origin_extra: null }
    case 'hook':
      return { origin_source: 'hook', origin_id: origin.webhookId, origin_extra: null }
    case 'browser-agent':
      return { origin_source: 'browser-agent', origin_id: null, origin_extra: null }
    case 'skill-creator':
      return { origin_source: 'skill-creator', origin_id: null, origin_extra: null }
    case 'agent-creator':
      return { origin_source: 'agent-creator', origin_id: null, origin_extra: null }
    case 'command-creator':
      return { origin_source: 'command-creator', origin_id: null, origin_extra: null }
    case 'rule-creator':
      return { origin_source: 'rule-creator', origin_id: null, origin_extra: null }
    case 'issue-creator':
      return { origin_source: 'issue-creator', origin_id: null, origin_extra: null }
    case 'schedule-creator':
      return { origin_source: 'schedule-creator', origin_id: null, origin_extra: null }
    case 'bot-creator':
      return { origin_source: 'bot-creator', origin_id: null, origin_extra: null }
    case 'market-analyzer':
      return {
        origin_source: 'market-analyzer',
        origin_id: origin.slug,
        origin_extra: origin.marketplaceId,
      }
    case 'review':
      return {
        origin_source: 'review',
        origin_id: origin.issueId,
        origin_extra: JSON.stringify({
          sessionId: origin.sessionId,
          turnAnchorMessageId: origin.turnAnchorMessageId,
        }),
      }
    default:
      return { origin_source: 'agent', origin_id: null, origin_extra: null }
  }
}

export function managedSessionRowToInfo(row: ManagedSessionTable): ManagedSessionInfo {
  const engineSessionRef = row.sdk_session_id
  return {
    id: row.id,
    engineSessionRef,
    engineState: parseEngineState(row.engine_state_json),
    state: row.state as ManagedSessionInfo['state'],
    stopReason: row.stop_reason as ManagedSessionInfo['stopReason'],
    origin: rowToOrigin(row.origin_source, row.origin_id, row.origin_extra),
    projectPath: row.project_path,
    projectId: row.project_id,
    model: row.model,
    messages: JSON.parse(row.messages) as ManagedSessionMessage[],
    createdAt: row.created_at,
    lastActivity: row.last_activity,
    activeDurationMs: row.active_duration_ms,
    activeStartedAt: row.active_started_at,
    totalCostUsd: row.total_cost_usd,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    lastInputTokens: row.last_input_tokens,
    contextLimitOverride: null,
    contextState: null,
    contextTelemetry: null,
    activity: row.activity,
    error: row.error,
    executionContext: row.execution_context
      ? (JSON.parse(row.execution_context) as SessionExecutionContext)
      : null,
    providerProfileId: rowProviderProfileIdToDomain(row.provider_profile_id),
  }
}

function rowProviderProfileIdToDomain(
  raw: string | null,
): ProviderProfileId | null {
  if (raw === null || raw.length === 0) return null
  return asProviderProfileId(raw)
}

export function managedSessionInfoToRow(session: ManagedSessionInfo): ManagedSessionTable {
  const { origin_source, origin_id, origin_extra } = originToColumns(session.origin)
  const engineSessionRef = session.engineSessionRef ?? null

  return {
    id: session.id,
    sdk_session_id: engineSessionRef,
    // engine_kind is a constant column: DB retains TEXT NOT NULL, app only ever writes 'claude'.
    // See docs/proposals/2026-04-12-provider-management-redesign.md §4.3 for deferred-drop plan.
    engine_kind: 'claude',
    engine_state_json: session.engineState ? JSON.stringify(session.engineState) : null,
    state: session.state,
    stop_reason: session.stopReason,
    origin_source,
    origin_id,
    origin_extra,
    project_path: session.projectPath,
    project_id: session.projectId,
    model: session.model,
    messages: JSON.stringify(session.messages),
    created_at: session.createdAt,
    last_activity: session.lastActivity,
    active_duration_ms: session.activeDurationMs,
    active_started_at: session.activeStartedAt,
    total_cost_usd: session.totalCostUsd,
    input_tokens: session.inputTokens,
    output_tokens: session.outputTokens,
    last_input_tokens: session.lastInputTokens,
    activity: session.activity,
    error: session.error,
    execution_context: session.executionContext ? JSON.stringify(session.executionContext) : null,
    provider_profile_id: session.providerProfileId,
  }
}
