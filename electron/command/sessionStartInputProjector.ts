// SPDX-License-Identifier: Apache-2.0

import type { StartSessionInput } from '../../src/shared/types'
import { z } from 'zod/v4'

const userTextBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
}).strict()

const userImageBlockSchema = z.object({
  type: z.literal('image'),
  mediaType: z.string(),
  data: z.string(),
  sizeBytes: z.number().int().nonnegative(),
}).strict()

const userDocumentBlockSchema = z.object({
  type: z.literal('document'),
  mediaType: z.string(),
  data: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  title: z.string(),
}).strict()

const userSlashCommandBlockSchema = z.object({
  type: z.literal('slash_command'),
  name: z.string(),
  category: z.enum(['command', 'skill']),
  label: z.string(),
  execution: z.object({
    nativeRequirements: z.array(z.object({
      capability: z.string(),
      tool: z.string().optional(),
    }).strict()),
    providerExecution: z.object({
      provider: z.literal('evose'),
      appId: z.string(),
      appType: z.enum(['agent', 'workflow']),
      gatewayTool: z.enum(['evose_run_agent', 'evose_run_workflow']),
    }).strict().optional(),
  }).strict().optional(),
  expandedText: z.string(),
}).strict()

const userMessageContentSchema = z.union([
  z.string(),
  z.array(
    z.discriminatedUnion('type', [
      userTextBlockSchema,
      userImageBlockSchema,
      userDocumentBlockSchema,
      userSlashCommandBlockSchema,
    ]),
  ),
])

const sessionOriginSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('agent') }).strict(),
  z.object({ source: z.literal('issue'), issueId: z.string() }).strict(),
  z.object({ source: z.literal('telegram'), botId: z.string(), chatId: z.string() }).strict(),
  z.object({ source: z.literal('feishu'), appId: z.string(), chatId: z.string() }).strict(),
  z.object({
    source: z.literal('discord'),
    botId: z.string(),
    channelId: z.string(),
    guildId: z.string().optional(),
  }).strict(),
  z.object({ source: z.literal('schedule'), scheduleId: z.string() }).strict(),
  z.object({ source: z.literal('hook'), webhookId: z.string() }).strict(),
  z.object({ source: z.literal('browser-agent') }).strict(),
  z.object({
    source: z.literal('review'),
    issueId: z.string(),
    sessionId: z.string(),
    turnAnchorMessageId: z.string().optional(),
  }).strict(),
  z.object({ source: z.literal('skill-creator') }).strict(),
  z.object({ source: z.literal('agent-creator') }).strict(),
  z.object({ source: z.literal('command-creator') }).strict(),
  z.object({ source: z.literal('rule-creator') }).strict(),
  z.object({ source: z.literal('issue-creator') }).strict(),
  z.object({ source: z.literal('schedule-creator') }).strict(),
  z.object({ source: z.literal('bot-creator') }).strict(),
  z.object({
    source: z.literal('market-analyzer'),
    slug: z.string(),
    marketplaceId: z.string(),
  }).strict(),
])

const startSessionPolicySchema = z.object({
  tools: z.object({
    builtin: z.object({
      enabled: z.boolean().optional(),
    }).strict().optional(),
    native: z.object({
      mode: z.enum(['none', 'allowlist']).optional(),
      allow: z.array(z.object({
        capability: z.string(),
        tool: z.string().optional(),
      }).strict()).optional(),
    }).strict().optional(),
  }).strict().optional(),
  capabilities: z.object({
    skill: z.object({
      maxChars: z.number().int().positive().optional(),
      explicit: z.array(z.string()).optional(),
      implicitQuery: z.string().optional(),
    }).strict().optional(),
  }).strict().optional(),
}).strict()

const startSessionInputSchema = z.object({
  prompt: userMessageContentSchema,
  origin: sessionOriginSchema.optional(),
  engineKind: z.enum(['claude', 'codex']).optional(),
  workspace: z.discriminatedUnion('scope', [
    z.object({
      scope: z.literal('project'),
      projectId: z.string(),
    }).strict(),
    z.object({
      scope: z.literal('global'),
    }).strict(),
    z.object({
      scope: z.literal('custom-path'),
      cwd: z.string(),
    }).strict(),
  ]).optional(),
  model: z.string().optional(),
  maxTurns: z.number().int().positive().optional(),
  systemPrompt: z.string().optional(),
  policy: startSessionPolicySchema.optional(),
  contextSystemPrompt: z.string().optional(),
}).strict()

/**
 * Project untrusted session-start payloads onto the shared StartSessionInput contract.
 *
 * Why this exists:
 * - IPC handler arguments are runtime-`unknown` (cast by registerHandler).
 * - Backend-only fields (for example `customMcpServers`, `onComplete`) must not
 *   be accepted from renderer callers.
 *
 * This function performs strict runtime validation and rejects unknown keys.
 * Any malformed payload fails fast at the IPC boundary.
 */
export function projectStartSessionInput(input: unknown): StartSessionInput {
  const parsed = startSessionInputSchema.safeParse(input)
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => issue.message).join('; ')
    throw new Error(`Invalid start-session payload: ${details}`)
  }
  return parsed.data as StartSessionInput
}
