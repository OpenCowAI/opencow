// SPDX-License-Identifier: Apache-2.0

/**
 * botOutputParser — Extracts structured IM bot configuration from AI conversation.
 *
 * The AI Bot Creator outputs bot config inside a `bot-output` code fence with
 * YAML frontmatter (metadata) and a body (setup notes):
 *
 * ```bot-output
 * ---
 * platform: telegram
 * name: "My Project Bot"
 * botToken: "123456:ABC-DEF..."
 * ---
 * Bot created successfully! You can now enable it to start receiving messages.
 * ```
 *
 * The parser uses a two-stage approach:
 *   1. Generic parse via `codeFenceScanner` (tag + frontmatter + body)
 *   2. Platform-specific validation via the `IMConnection` discriminated union
 *
 * This mirrors the issue/schedule parser pattern but validates platform-specific
 * credential fields based on the `platform` discriminant.
 *
 * @module
 */

import { scanLastFencedBlock, scanLastFencedBlockFromMessages } from './codeFenceScanner'
import type { IMPlatformType, ManagedSessionMessage } from './types'

// ─── Types ───────────────────────────────────────────────────────────────────

/** Shared base fields for all bot output types. */
interface ParsedBotOutputBase {
  /** Display name for the bot connection. */
  name: string
  /** Optional user IDs allowed to interact. */
  allowedUserIds?: string[]
  /** Optional default workspace path. */
  defaultWorkspacePath?: string
  /** Body content — setup notes / instructions for the user. */
  notes: string
}

export interface ParsedTelegramBotOutput extends ParsedBotOutputBase {
  platform: 'telegram'
  botToken: string
}

export interface ParsedFeishuBotOutput extends ParsedBotOutputBase {
  platform: 'feishu'
  appId: string
  appSecret: string
  domain?: 'feishu' | 'lark'
}

export interface ParsedDiscordBotOutput extends ParsedBotOutputBase {
  platform: 'discord'
  botToken: string
  guildId?: string
}

export interface ParsedWeixinBotOutput extends ParsedBotOutputBase {
  platform: 'weixin'
  /** WeChat bot token — typically empty; obtained via QR scan after creation. */
  botToken: string
  baseUrl?: string
}

/** Discriminated union of all parsed bot output types, keyed by `platform`. */
export type ParsedBotOutput =
  | ParsedTelegramBotOutput
  | ParsedFeishuBotOutput
  | ParsedDiscordBotOutput
  | ParsedWeixinBotOutput

// ─── Constants ───────────────────────────────────────────────────────────────

const BOT_FENCE_TAG = 'bot-output' as const
const BOT_FENCE_TAGS: readonly string[] = [BOT_FENCE_TAG]

const VALID_PLATFORMS: ReadonlySet<string> = new Set<IMPlatformType>([
  'telegram', 'feishu', 'discord', 'weixin',
])

const VALID_DOMAINS: ReadonlySet<string> = new Set(['feishu', 'lark'])

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  return undefined
}

function parseStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const arr = value
      .map((v) => (typeof v === 'string' ? v.trim() : String(v).trim()))
      .filter(Boolean)
    return arr.length > 0 ? arr : undefined
  }
  if (typeof value === 'string') {
    const arr = value.split(',').map((s) => s.trim()).filter(Boolean)
    return arr.length > 0 ? arr : undefined
  }
  return undefined
}

// ─── Platform-specific validation ────────────────────────────────────────────

function mapTelegram(
  attrs: Record<string, unknown>,
  base: ParsedBotOutputBase
): ParsedTelegramBotOutput | null {
  const botToken = parseString(attrs.botToken ?? attrs['bot-token'])
  if (!botToken) return null
  return { ...base, platform: 'telegram', botToken }
}

function mapFeishu(
  attrs: Record<string, unknown>,
  base: ParsedBotOutputBase
): ParsedFeishuBotOutput | null {
  const appId = parseString(attrs.appId ?? attrs['app-id'])
  const appSecret = parseString(attrs.appSecret ?? attrs['app-secret'])
  if (!appId || !appSecret) return null
  const rawDomain = parseString(attrs.domain)
  const domain = rawDomain && VALID_DOMAINS.has(rawDomain) ? rawDomain as 'feishu' | 'lark' : undefined
  return { ...base, platform: 'feishu', appId, appSecret, domain }
}

function mapDiscord(
  attrs: Record<string, unknown>,
  base: ParsedBotOutputBase
): ParsedDiscordBotOutput | null {
  const botToken = parseString(attrs.botToken ?? attrs['bot-token'])
  if (!botToken) return null
  const guildId = parseString(attrs.guildId ?? attrs['guild-id'])
  return { ...base, platform: 'discord', botToken, guildId }
}

function mapWeixin(
  attrs: Record<string, unknown>,
  base: ParsedBotOutputBase
): ParsedWeixinBotOutput {
  // botToken is typically empty for WeChat — obtained via QR code scan after creation.
  const botToken = parseString(attrs.botToken ?? attrs['bot-token']) ?? ''
  const baseUrl = parseString(attrs.baseUrl ?? attrs['base-url'])
  return { ...base, platform: 'weixin', botToken, ...(baseUrl ? { baseUrl } : {}) }
}

// ─── Domain mapping ──────────────────────────────────────────────────────────

function mapToBotOutput(
  attributes: Record<string, unknown>,
  body: string
): ParsedBotOutput | null {
  // Platform is required
  const rawPlatform = parseString(attributes.platform)
  if (!rawPlatform || !VALID_PLATFORMS.has(rawPlatform)) return null
  const platform = rawPlatform as IMPlatformType

  // Name is required
  const name = parseString(attributes.name)
  if (!name) return null

  // Build shared base
  const base: ParsedBotOutputBase = {
    name,
    allowedUserIds: parseStringArray(attributes.allowedUserIds ?? attributes['allowed-user-ids']),
    defaultWorkspacePath: parseString(attributes.defaultWorkspacePath ?? attributes['default-workspace-path']),
    notes: body.trim()
  }

  // Dispatch to platform-specific mapper
  switch (platform) {
    case 'telegram': return mapTelegram(attributes, base)
    case 'feishu':   return mapFeishu(attributes, base)
    case 'discord':  return mapDiscord(attributes, base)
    case 'weixin':   return mapWeixin(attributes, base)
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Extract a ParsedBotOutput from a single text block.
 * Returns null if no valid bot-output fence is found or required fields are missing.
 *
 * When multiple output blocks exist, returns the **last** one.
 */
export function parseBotOutput(text: string): ParsedBotOutput | null {
  const scanned = scanLastFencedBlock(text, BOT_FENCE_TAGS)
  if (!scanned) return null
  return mapToBotOutput(scanned.attributes, scanned.body)
}

/**
 * Scan session messages in reverse order and extract the most recent
 * bot-output from assistant messages.
 */
export function extractLatestBotOutput(
  messages: ManagedSessionMessage[]
): ParsedBotOutput | null {
  const scanned = scanLastFencedBlockFromMessages(messages, BOT_FENCE_TAGS)
  if (!scanned) return null
  return mapToBotOutput(scanned.attributes, scanned.body)
}
