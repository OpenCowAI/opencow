// SPDX-License-Identifier: Apache-2.0

import { readFile, writeFile, mkdir } from 'fs/promises'
import { randomUUID } from 'crypto'
import { dirname } from 'path'
import {
  type AIEngineKind,
  DEFAULT_EVOSE_SETTINGS,
  DEFAULT_UPDATE_SETTINGS,
  type AppSettings,
  type CommandDefaults,
  type EvoseAppConfig,
  type EvoseSettings,
  type DiscordConnection,
  type FeishuConnection,
  type IMConnection,
  type MessagingSettings,
  type EventSubscriptionSettings,
  type ProviderEngineSettings,
  type ProviderSettings,
  type CodexReasoningEffort,
  type TelegramBotEntry,
  type TelegramBotSettings,
  type TelegramConnection,
  type ThemeConfig,
  type ThemeMode,
  type UpdateCheckInterval,
  type UpdateSettings,
  type WebhookEndpoint,
} from '../../src/shared/types'
import { toTelegramBotEntry } from './telegramBot/converters'
import { toFeishuBotEntry } from './feishuBot/converters'
import type { FeishuBotSettings } from './feishuBot/types'
import { toDiscordBotEntry } from './discordBot/converters'
import type { DiscordBotSettings } from './discordBot/types'
import { resolveThemeConfig, DEFAULT_THEME_CONFIG } from '../../src/shared/themeRegistry'

const DEFAULT_SETTINGS: AppSettings = {
  theme: DEFAULT_THEME_CONFIG,
  proxy: {
    httpsProxy: '',
    httpProxy: '',
    noProxy: ''
  },
  command: {
    maxTurns: 10000,
    permissionMode: 'bypassPermissions',
    defaultEngine: 'claude',
  },
  eventSubscriptions: {
    enabled: true,
    onError: true,
    onComplete: true,
    onStatusChange: true
  },
  webhooks: {
    endpoints: []
  },
  provider: {
    byEngine: {
      claude: {
        activeMode: null,
      },
      codex: {
        activeMode: null,
        defaultReasoningEffort: 'high',
      },
    },
  },
  messaging: {
    connections: [],
  },
  schedule: {
    enabled: true,
    maxConcurrentExecutions: 3,
    quietHours: {
      enabled: false,
      start: '23:00',
      end: '07:00',
    },
  },
  evose: DEFAULT_EVOSE_SETTINGS,
  language: 'system',
  updates: DEFAULT_UPDATE_SETTINGS,
}

export class SettingsService {
  private filePath: string
  private cache: AppSettings | null = null

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async load(): Promise<AppSettings> {
    if (this.cache) return this.cache

    try {
      const raw = await readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Record<string, unknown>
      this.cache = this.mergeWithDefaults(parsed)
    } catch {
      this.cache = this.mergeWithDefaults({})
    }

    return this.cache
  }

  async update(settings: AppSettings): Promise<AppSettings> {
    this.cache = settings
    const dir = dirname(this.filePath)
    await mkdir(dir, { recursive: true })
    await writeFile(this.filePath, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
    return this.cache
  }

  getSettings(): AppSettings {
    if (!this.cache) {
      throw new Error('SettingsService not loaded. Call load() first.')
    }
    return this.cache
  }

  getProxyEnv(): Record<string, string> {
    const settings = this.getSettings()
    const env: Record<string, string> = {}
    if (settings.proxy.httpsProxy) {
      env.https_proxy = settings.proxy.httpsProxy
      env.HTTPS_PROXY = settings.proxy.httpsProxy
    }
    if (settings.proxy.httpProxy) {
      env.http_proxy = settings.proxy.httpProxy
      env.HTTP_PROXY = settings.proxy.httpProxy
    }
    if (settings.proxy.noProxy) {
      env.no_proxy = settings.proxy.noProxy
      env.NO_PROXY = settings.proxy.noProxy
    }
    return env
  }

  getCommandDefaults(): CommandDefaults {
    return this.getSettings().command
  }

  getEventSubscriptionSettings(): EventSubscriptionSettings {
    return this.getSettings().eventSubscriptions
  }

  getProviderSettings(): ProviderSettings {
    return this.getSettings().provider
  }

  getWebhookEndpoints(): WebhookEndpoint[] {
    return this.getSettings().webhooks.endpoints
  }

  getMessagingSettings(): MessagingSettings {
    return this.getSettings().messaging
  }

  /** Convenience: extract Telegram connections and convert to internal TelegramBotSettings format. */
  getTelegramBotSettings(): TelegramBotSettings {
    const conns = this.getSettings().messaging.connections
      .filter((c): c is TelegramConnection => c.platform === 'telegram')
    return { bots: conns.map(toTelegramBotEntry) }
  }

  /** Convenience: extract Feishu connections and convert to internal FeishuBotSettings format. */
  getFeishuBotSettings(): FeishuBotSettings {
    const conns = this.getSettings().messaging.connections
      .filter((c): c is FeishuConnection => c.platform === 'feishu')
    return { bots: conns.map(toFeishuBotEntry) }
  }

  /** Convenience: extract Discord connections and convert to internal DiscordBotSettings format. */
  getDiscordBotSettings(): DiscordBotSettings {
    const conns = this.getSettings().messaging.connections
      .filter((c): c is DiscordConnection => c.platform === 'discord')
    return { bots: conns.map(toDiscordBotEntry) }
  }

  private mergeWithDefaults(partial: Record<string, unknown>): AppSettings {
    const p = partial as Partial<AppSettings> & {
      theme?: unknown
      telegramBot?: Record<string, unknown>
      /** Legacy key — old settings persisted under `auth`; migrate to `provider`. */
      auth?: Partial<ProviderSettings> & Record<string, unknown>
      /** Legacy key — old command.defaultModel migrated to provider.byEngine.claude.defaultModel. */
      command?: Record<string, unknown>
    }

    // Migration: read from `provider` first, fall back to legacy `auth` key.
    const providerRaw = (p.provider ?? p.auth) as (Partial<ProviderSettings> & Record<string, unknown>) | undefined

    // Migrate legacy command.defaultModel → provider.byEngine.claude.defaultModel (if not already set).
    const legacyCommandModel = p.command?.defaultModel
    const legacyCommandModelStr = typeof legacyCommandModel === 'string' && legacyCommandModel ? legacyCommandModel : undefined

    return {
      theme: migrateTheme(p.theme),
      proxy: {
        httpsProxy: p.proxy?.httpsProxy ?? DEFAULT_SETTINGS.proxy.httpsProxy,
        httpProxy: p.proxy?.httpProxy ?? DEFAULT_SETTINGS.proxy.httpProxy,
        noProxy: p.proxy?.noProxy ?? DEFAULT_SETTINGS.proxy.noProxy
      },
      command: {
        maxTurns: (p.command?.maxTurns as number) ?? DEFAULT_SETTINGS.command.maxTurns,
        permissionMode: normalizePermissionMode((p.command as Record<string, unknown> | undefined)?.permissionMode),
        defaultEngine: normalizeEngine((p.command as Record<string, unknown> | undefined)?.defaultEngine),
      },
      eventSubscriptions: {
        enabled: p.eventSubscriptions?.enabled ?? DEFAULT_SETTINGS.eventSubscriptions.enabled,
        onError: p.eventSubscriptions?.onError ?? DEFAULT_SETTINGS.eventSubscriptions.onError,
        onComplete: p.eventSubscriptions?.onComplete ?? DEFAULT_SETTINGS.eventSubscriptions.onComplete,
        onStatusChange: p.eventSubscriptions?.onStatusChange ?? DEFAULT_SETTINGS.eventSubscriptions.onStatusChange
      },
      webhooks: {
        // Normalise older persisted endpoints that pre-date the `useProxy` field.
        endpoints: (p.webhooks?.endpoints ?? DEFAULT_SETTINGS.webhooks.endpoints).map((ep) => ({
          ...ep,
          useProxy: ep.useProxy ?? false,
        }))
      },
      provider: migrateProviderSettings(providerRaw, legacyCommandModelStr),
      messaging: migrateToMessaging(p),
      schedule: {
        enabled: p.schedule?.enabled ?? DEFAULT_SETTINGS.schedule.enabled,
        maxConcurrentExecutions: p.schedule?.maxConcurrentExecutions ?? DEFAULT_SETTINGS.schedule.maxConcurrentExecutions,
        quietHours: {
          enabled: p.schedule?.quietHours?.enabled ?? DEFAULT_SETTINGS.schedule.quietHours.enabled,
          start: p.schedule?.quietHours?.start ?? DEFAULT_SETTINGS.schedule.quietHours.start,
          end: p.schedule?.quietHours?.end ?? DEFAULT_SETTINGS.schedule.quietHours.end,
        },
      },
      evose: mergeEvoseSettings(p.evose),
      language: p.language ?? DEFAULT_SETTINGS.language,
      updates: mergeUpdateSettings(p.updates),
    }
  }
}

// ── Messaging settings migration ────────────────────────────────────────────

type PartialWithLegacy = Partial<AppSettings> & {
  telegramBot?: Record<string, unknown>
  telegramBots?: { bots?: unknown[] } | Record<string, unknown>
  imBridge?: { connections?: IMConnection[] }
}

/**
 * Migrate persisted settings to the unified `messaging.connections[]` model.
 *
 * Priority (highest to lowest):
 *   1. New format: `messaging.connections` → use directly.
 *   2. Old multi-bot format: `telegramBots.bots[]` → convert each to TelegramConnection.
 *   3. Legacy single-bot: `telegramBot` object → convert to TelegramConnection.
 *   4. Old imBridge.connections → merge in.
 *   5. Empty fallback.
 */
function migrateToMessaging(p: PartialWithLegacy): MessagingSettings {
  // 1. New format already present — use as-is (normalize entries)
  const msgRaw = (p as Record<string, unknown>).messaging as Record<string, unknown> | undefined
  if (msgRaw && Array.isArray(msgRaw.connections) && msgRaw.connections.length > 0) {
    return { connections: (msgRaw.connections as unknown[]).map(normalizeIMConnection) }
  }

  const result: IMConnection[] = []

  // 2. Migrate old `telegramBots.bots[]` format
  const rawBots = p.telegramBots
  if (rawBots && typeof rawBots === 'object' && Array.isArray((rawBots as Record<string, unknown>).bots)) {
    const bots = ((rawBots as Record<string, unknown>).bots as unknown[])
    for (const raw of bots) {
      result.push(legacyBotEntryToTelegramConnection(normalizeLegacyBotEntry(raw)))
    }
  }

  // 3. Legacy single-bot migration
  if (result.length === 0) {
    const legacy = p.telegramBot
    if (legacy && typeof legacy.botToken === 'string' && legacy.botToken) {
      result.push(legacyBotEntryToTelegramConnection(
        normalizeLegacyBotEntry({ ...legacy, id: randomUUID(), name: 'My Bot' })
      ))
    }
  }

  // 4. Merge old imBridge.connections (feishu/discord)
  if (Array.isArray(p.imBridge?.connections)) {
    result.push(...p.imBridge!.connections)
  }

  return { connections: result }
}

/**
 * Normalise a raw IMConnection from persisted JSON.
 * Fills missing fields with safe defaults.
 */
function normalizeIMConnection(raw: unknown): IMConnection {
  const r = (raw ?? {}) as Record<string, unknown>
  const platform = r.platform as string

  const base = {
    id:                   typeof r.id === 'string' && r.id     ? r.id   : randomUUID(),
    name:                 typeof r.name === 'string' && r.name ? r.name : 'My Connection',
    enabled:              r.enabled === true,
    allowedUserIds:       Array.isArray(r.allowedUserIds) ? (r.allowedUserIds as string[]) : [],
    defaultWorkspacePath: typeof r.defaultWorkspacePath === 'string' ? r.defaultWorkspacePath : '',
    ...(typeof r.defaultProjectId === 'string' ? { defaultProjectId: r.defaultProjectId } : {}),
  }

  switch (platform) {
    case 'telegram':
      return {
        ...base,
        platform: 'telegram',
        botToken: typeof r.botToken === 'string' ? r.botToken : '',
      }
    case 'feishu':
      return {
        ...base,
        platform: 'feishu',
        appId:     typeof r.appId === 'string'     ? r.appId     : '',
        appSecret: typeof r.appSecret === 'string' ? r.appSecret : '',
      }
    case 'discord':
      return {
        ...base,
        platform: 'discord',
        botToken: typeof r.botToken === 'string' ? r.botToken : '',
        ...(typeof r.guildId === 'string' ? { guildId: r.guildId } : {}),
      }
    case 'weixin':
      return {
        ...base,
        platform: 'weixin',
        botToken: typeof r.botToken === 'string' ? r.botToken : '',
        ...(typeof r.baseUrl === 'string' ? { baseUrl: r.baseUrl } : {}),
      }
    default:
      // Unknown platform — warn and fallback to telegram shape to avoid data loss
      console.warn(`[SettingsService] Unknown IM platform "${r.platform}", falling back to telegram shape`)
      return {
        ...base,
        platform: 'telegram',
        botToken: typeof r.botToken === 'string' ? r.botToken : '',
      }
  }
}

/**
 * Normalise a raw legacy TelegramBotEntry from persisted JSON.
 */
function normalizeLegacyBotEntry(raw: unknown): TelegramBotEntry {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    id:                   typeof r.id === 'string'   && r.id   ? r.id   : randomUUID(),
    name:                 typeof r.name === 'string' && r.name ? r.name : 'My Bot',
    enabled:              r.enabled === true,
    botToken:             typeof r.botToken === 'string'             ? r.botToken             : '',
    allowedUserIds:       Array.isArray(r.allowedUserIds)            ? (r.allowedUserIds as number[]) : [],
    defaultWorkspacePath: typeof r.defaultWorkspacePath === 'string' ? r.defaultWorkspacePath : '',
  }
}

/**
 * Convert a legacy TelegramBotEntry to the unified TelegramConnection format.
 * Maps number[] allowedUserIds to string[].
 */
function legacyBotEntryToTelegramConnection(entry: TelegramBotEntry): TelegramConnection {
  return {
    id: entry.id,
    name: entry.name,
    platform: 'telegram',
    enabled: entry.enabled,
    botToken: entry.botToken,
    allowedUserIds: entry.allowedUserIds.map(String),
    defaultWorkspacePath: entry.defaultWorkspacePath,
  }
}

// ── Provider settings migration ───────────────────────────────────────────────

const VALID_PROVIDER_MODES = new Set(['subscription', 'api_key', 'openrouter', 'custom'])
const VALID_CODEX_REASONING_EFFORTS: ReadonlySet<CodexReasoningEffort> =
  new Set(['minimal', 'low', 'medium', 'high', 'xhigh'])

function normalizeProviderMode(raw: unknown): ProviderSettings['byEngine']['claude']['activeMode'] {
  if (typeof raw !== 'string') return null
  return VALID_PROVIDER_MODES.has(raw) ? raw as ProviderSettings['byEngine']['claude']['activeMode'] : null
}

function normalizeCodexReasoningEffort(raw: unknown): CodexReasoningEffort | undefined {
  if (typeof raw !== 'string') return undefined
  return VALID_CODEX_REASONING_EFFORTS.has(raw as CodexReasoningEffort)
    ? raw as CodexReasoningEffort
    : undefined
}

function pickLegacyDefaultModel(raw: Record<string, unknown> | undefined, legacyCommandModel?: string): string | undefined {
  const legacyCustomModel = (raw?.custom as Record<string, unknown> | undefined)?.defaultModel
  const legacyOpenRouterModel = (raw?.openrouter as Record<string, unknown> | undefined)?.defaultModel
  const topLevelDefaultModel = raw?.defaultModel
  return (typeof topLevelDefaultModel === 'string' && topLevelDefaultModel)
    || legacyCommandModel
    || (typeof legacyCustomModel === 'string' ? legacyCustomModel : undefined)
    || (typeof legacyOpenRouterModel === 'string' ? legacyOpenRouterModel : undefined)
}

function normalizeEngineProviderSettings(
  raw: unknown,
  fallback: ProviderEngineSettings,
): ProviderEngineSettings {
  const r = (raw ?? {}) as Record<string, unknown>
  const hasActiveMode = Object.prototype.hasOwnProperty.call(r, 'activeMode')
  const hasDefaultModel = Object.prototype.hasOwnProperty.call(r, 'defaultModel')
  const hasDefaultReasoningEffort = Object.prototype.hasOwnProperty.call(r, 'defaultReasoningEffort')
  const activeMode = normalizeProviderMode(r.activeMode)
  const defaultModel = typeof r.defaultModel === 'string' && r.defaultModel ? r.defaultModel : undefined
  const defaultReasoningEffort = normalizeCodexReasoningEffort(r.defaultReasoningEffort)
  return {
    activeMode: hasActiveMode ? activeMode : fallback.activeMode,
    ...(hasDefaultModel
      ? (defaultModel ? { defaultModel } : {})
      : (fallback.defaultModel ? { defaultModel: fallback.defaultModel } : {})),
    ...(hasDefaultReasoningEffort
      ? (defaultReasoningEffort ? { defaultReasoningEffort } : {})
      : (fallback.defaultReasoningEffort ? { defaultReasoningEffort: fallback.defaultReasoningEffort } : {})),
  }
}

/**
 * Migrate provider settings to engine-scoped shape.
 *
 * New shape:
 *   provider.byEngine.claude.activeMode/defaultModel
 *   provider.byEngine.codex.activeMode/defaultModel/defaultReasoningEffort
 *
 * Legacy fallback:
 *   - provider.activeMode/defaultModel (or auth.*) is migrated into `byEngine.claude`
 *   - `byEngine.codex` starts empty (no implicit credentials)
 */
function migrateProviderSettings(
  raw: (Partial<ProviderSettings> & Record<string, unknown>) | undefined,
  legacyCommandModel?: string,
): ProviderSettings {
  const source = (raw ?? {}) as Record<string, unknown>

  const legacyClaude: ProviderSettings['byEngine']['claude'] = {
    activeMode: normalizeProviderMode(source.activeMode),
    ...(pickLegacyDefaultModel(source, legacyCommandModel)
      ? { defaultModel: pickLegacyDefaultModel(source, legacyCommandModel) }
      : {}),
  }

  const byEngineRaw = source.byEngine as Record<string, unknown> | undefined

  return {
    byEngine: {
      claude: normalizeEngineProviderSettings(
        byEngineRaw?.claude,
        legacyClaude,
      ),
      codex: normalizeEngineProviderSettings(
        byEngineRaw?.codex,
        { activeMode: null, defaultReasoningEffort: 'high' },
      ),
    },
  }
}

// ── Theme migration ───────────────────────────────────────────────────────────

/**
 * Migrate legacy `theme: "dark"` string format to the new structured `ThemeConfig`.
 * Also validates/normalizes the new format.
 */
function migrateTheme(raw: unknown): ThemeConfig {
  if (typeof raw === 'string') {
    // Legacy format: theme was a bare ThemeMode string → wrap into ThemeConfig
    return resolveThemeConfig({ mode: raw as ThemeMode, scheme: 'zinc' })
  }
  return resolveThemeConfig(raw)
}

// ── Evose settings helpers ────────────────────────────────────────────────────

function mergeEvoseSettings(raw: unknown): EvoseSettings {
  const r = (raw ?? {}) as Partial<EvoseSettings>
  return {
    apiKey:       typeof r.apiKey === 'string'  ? r.apiKey       : DEFAULT_EVOSE_SETTINGS.apiKey,
    baseUrl:      normalizeEvoseBaseUrl(r.baseUrl),
    workspaceIds: Array.isArray(r.workspaceIds) ? r.workspaceIds : DEFAULT_EVOSE_SETTINGS.workspaceIds,
    apps:         Array.isArray(r.apps)         ? r.apps.map(normalizeEvoseAppConfig) : DEFAULT_EVOSE_SETTINGS.apps,
  }
}

function normalizeEvoseBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_EVOSE_SETTINGS.baseUrl
  const trimmed = raw.trim()
  return trimmed || DEFAULT_EVOSE_SETTINGS.baseUrl
}

/** Type predicate: safely narrow unknown to EvoseAppConfig.type */
function isEvoseAppType(v: unknown): v is 'agent' | 'workflow' {
  return v === 'agent' || v === 'workflow'
}

function normalizeEvoseAppConfig(raw: unknown): EvoseAppConfig {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    appId:       typeof r['appId'] === 'string'       ? r['appId']       : '',
    name:        typeof r['name'] === 'string'         ? r['name']        : '',
    type:        isEvoseAppType(r['type'])              ? r['type']        : 'agent',
    enabled:     r['enabled'] === true,
    description: typeof r['description'] === 'string'  ? r['description'] : undefined,
    avatar:      typeof r['avatar'] === 'string'       ? r['avatar']      : undefined,
  }
}

// ── Update settings helpers ────────────────────────────────────────────────────

const VALID_UPDATE_INTERVALS = new Set<UpdateCheckInterval>(['1h', '4h', '12h', '24h'])

function mergeUpdateSettings(raw: unknown): UpdateSettings {
  const r = (raw ?? {}) as Partial<UpdateSettings>
  return {
    autoCheckUpdates: typeof r.autoCheckUpdates === 'boolean'
      ? r.autoCheckUpdates
      : DEFAULT_UPDATE_SETTINGS.autoCheckUpdates,
    updateCheckInterval: VALID_UPDATE_INTERVALS.has(r.updateCheckInterval as UpdateCheckInterval)
      ? r.updateCheckInterval as UpdateCheckInterval
      : DEFAULT_UPDATE_SETTINGS.updateCheckInterval,
  }
}

function normalizeEngine(raw: unknown): AIEngineKind {
  return raw === 'codex' ? 'codex' : 'claude'
}

function normalizePermissionMode(raw: unknown): AppSettings['command']['permissionMode'] {
  return raw === 'default' ? 'default' : 'bypassPermissions'
}
