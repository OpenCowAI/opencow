// SPDX-License-Identifier: Apache-2.0

import type {
  ApprovalMode,
  Input as CodexInput,
  ModelReasoningEffort,
  SandboxMode,
  Thread,
  ThreadEvent,
  Codex as CodexCtor,
} from '@openai/codex-sdk'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UserMessageContent } from '../../src/shared/types'
import { createLogger } from '../platform/logger'
import type { SessionLifecycle } from './sessionLifecycle'
import type { CodexConfigObject, CodexConfigValue } from './codexMcpConfigBuilder'
import {
  createRuntimeEventEnvelope,
  isTurnScopedRuntimeEventKind,
  type EngineRuntimeEvent,
  type EngineRuntimeEventEnvelope,
  type RuntimeTurnRef,
} from '../conversation/runtime/events'
import { CodexRuntimeEventAdapter } from '../conversation/runtime/codexRuntimeAdapter'
import { NativeCapabilityTools } from '../../src/shared/nativeCapabilityToolNames'

/** Safety timeout (ms) for stop() — mirrors QueryLifecycle semantics. */
const STOP_SAFETY_TIMEOUT_MS = 30_000
/** Timeout waiting for Codex SDK bootstrap (loader + thread creation). */
const STARTUP_BOOTSTRAP_TIMEOUT_MS = 20_000
/** Timeout waiting for Codex runStreamed startup / first event. */
const STARTUP_EVENT_TIMEOUT_MS = 20_000
/** Codex thread event types currently adapted by CodexRuntimeEventAdapter. */
const CODEX_THREAD_EVENT_TYPES = new Set([
  'thread.started',
  'turn.started',
  'item.started',
  'item.updated',
  'item.completed',
  'turn.completed',
  'turn.failed',
  'error',
])

const DEFAULT_SANDBOX_MODE: SandboxMode = 'workspace-write'
const DEFAULT_APPROVAL_POLICY: ApprovalMode = 'never'

const log = createLogger('CodexQueryLifecycle')

type CodexSdkModule = {
  Codex: typeof CodexCtor
}

const nativeDynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<unknown>

async function defaultCodexSdkLoader(): Promise<CodexSdkModule> {
  const mod = (await nativeDynamicImport('@openai/codex-sdk')) as Partial<CodexSdkModule>
  if (!mod.Codex) {
    throw new Error('Failed to load @openai/codex-sdk (Codex export missing)')
  }
  return { Codex: mod.Codex }
}

let codexSdkLoader: () => Promise<CodexSdkModule> = defaultCodexSdkLoader

/** Test-only seam: override Codex SDK loader to avoid spawning real CLI processes. */
export function __setCodexSdkLoaderForTest(loader: () => Promise<CodexSdkModule>): void {
  codexSdkLoader = loader
}

/** Reset test seam to the production dynamic ESM loader. */
export function __resetCodexSdkLoaderForTest(): void {
  codexSdkLoader = defaultCodexSdkLoader
}

interface ParsedCodexLifecycleOptions {
  env?: Record<string, string>
  apiKey?: string
  baseUrl?: string
  pathOverride?: string
  codexConfig?: CodexConfigObject
  model?: string
  cwd?: string
  resume?: string
  systemPrompt?: string
  sandboxMode?: SandboxMode
  approvalPolicy?: ApprovalMode
  skipGitRepoCheck?: boolean
  modelReasoningEffort?: ModelReasoningEffort
}

interface PreparedCodexInput {
  input: CodexInput
  cleanup: () => Promise<void>
}

const IMAGE_FILE_EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
}

class AsyncPushQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = []
  private resolver: ((value: T | null) => void) | null = null
  private closed = false

  push(value: T): void {
    if (this.closed) return
    if (this.resolver) {
      const resolve = this.resolver
      this.resolver = null
      resolve(value)
      return
    }
    this.buffer.push(value)
  }

  async shift(): Promise<T | null> {
    if (this.buffer.length > 0) return this.buffer.shift()!
    if (this.closed) return null
    return await new Promise<T | null>((resolve) => {
      this.resolver = resolve
    })
  }

  close(): void {
    this.closed = true
    if (this.resolver) {
      const resolve = this.resolver
      this.resolver = null
      resolve(null)
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
    while (true) {
      const value = await this.shift()
      if (value === null) return
      yield value
    }
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every((item) => typeof item === 'string')
}

function isCodexConfigValue(value: unknown): value is CodexConfigValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true
  }
  if (Array.isArray(value)) {
    return value.every((item) => isCodexConfigValue(item))
  }
  if (!value || typeof value !== 'object') {
    return false
  }
  return Object.values(value).every((item) => isCodexConfigValue(item))
}

function parseCodexConfig(value: unknown): CodexConfigObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (!Object.values(value).every((item) => isCodexConfigValue(item))) return undefined
  return value as CodexConfigObject
}

function parseSandboxMode(value: unknown): SandboxMode | undefined {
  return value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access'
    ? value
    : undefined
}

function parseApprovalMode(value: unknown): ApprovalMode | undefined {
  return value === 'never' || value === 'on-request' || value === 'on-failure' || value === 'untrusted'
    ? value
    : undefined
}

function parseModelReasoningEffort(value: unknown): ModelReasoningEffort | undefined {
  return value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh'
    ? value
    : undefined
}

function parseOptions(raw: Record<string, unknown>): ParsedCodexLifecycleOptions {
  return {
    env: isStringRecord(raw.env) ? raw.env : undefined,
    apiKey: typeof raw.codexApiKey === 'string' ? raw.codexApiKey : undefined,
    baseUrl: typeof raw.codexBaseUrl === 'string' ? raw.codexBaseUrl : undefined,
    pathOverride: typeof raw.codexPathOverride === 'string' ? raw.codexPathOverride : undefined,
    codexConfig: parseCodexConfig(raw.codexConfig),
    model: typeof raw.model === 'string' ? raw.model : undefined,
    cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
    resume: typeof raw.resume === 'string' ? raw.resume : undefined,
    systemPrompt: typeof raw.codexSystemPrompt === 'string' ? raw.codexSystemPrompt : undefined,
    sandboxMode: parseSandboxMode(raw.codexSandboxMode),
    approvalPolicy: parseApprovalMode(raw.codexApprovalPolicy),
    skipGitRepoCheck: typeof raw.codexSkipGitRepoCheck === 'boolean' ? raw.codexSkipGitRepoCheck : undefined,
    modelReasoningEffort: parseModelReasoningEffort(raw.codexModelReasoningEffort),
  }
}

function imageExtensionFromMediaType(mediaType: string): string {
  return IMAGE_FILE_EXTENSION_BY_MEDIA_TYPE[mediaType.toLowerCase()] ?? '.img'
}

function collectUserTextArgs(content: Exclude<UserMessageContent, string>): string {
  const userTextParts: string[] = []
  for (const block of content) {
    if (block.type === 'text') {
      userTextParts.push(block.text)
    }
  }
  return userTextParts.join('').trim()
}

function buildCommandXml(name: string, userArgs: string): string {
  return [
    `<command-message>${name}</command-message>`,
    `<command-name>/${name}</command-name>`,
    `<command-args>${userArgs}</command-args>`,
  ].join(' ')
}

function resolveEvoseGatewayToolName(
  gatewayTool: 'evose_run_agent' | 'evose_run_workflow',
): string {
  return gatewayTool === 'evose_run_agent'
    ? NativeCapabilityTools.EVOSE_RUN_AGENT
    : NativeCapabilityTools.EVOSE_RUN_WORKFLOW
}

function buildEvoseExecutionHint(
  providerExecution: {
    provider: 'evose'
    appId: string
    appType: 'agent' | 'workflow'
    gatewayTool: 'evose_run_agent' | 'evose_run_workflow'
  },
): string {
  const gatewayTool = resolveEvoseGatewayToolName(providerExecution.gatewayTool)
  return [
    '<command-execution provider="evose" explicit="true">',
    `<gateway-tool>${gatewayTool}</gateway-tool>`,
    `<app-id>${providerExecution.appId}</app-id>`,
    `<app-type>${providerExecution.appType}</app-type>`,
    '</command-execution>',
    `MANDATORY: User explicitly selected this Evose app. Call \`${gatewayTool}\` with app_id="${providerExecution.appId}" before unrelated tools.`,
  ].join('\n')
}

function renderSlashCommandForCodex(
  block: Extract<Exclude<UserMessageContent, string>[number], { type: 'slash_command' }>,
  userArgs: string,
): string[] {
  const out: string[] = [buildCommandXml(block.name, userArgs)]
  const providerExecution = block.execution?.providerExecution
  if (providerExecution?.provider === 'evose') {
    out.push(buildEvoseExecutionHint(providerExecution))
  }
  out.push(block.expandedText)
  return out
}

function toCodexTextPrompt(content: UserMessageContent): string {
  if (typeof content === 'string') return content

  const userArgs = collectUserTextArgs(content)
  const parts: string[] = []
  for (const block of content) {
    switch (block.type) {
      case 'text':
        parts.push(block.text)
        break
      case 'slash_command':
        parts.push(...renderSlashCommandForCodex(block, userArgs))
        break
      case 'image':
        parts.push(`[Image omitted: ${block.mediaType}]`)
        break
      case 'document':
        if (block.mediaType === 'text/plain') {
          parts.push(block.data)
        } else {
          const title = block.title ?? 'document'
          parts.push(`[Document omitted: ${title} (${block.mediaType})]`)
        }
        break
      default: {
        const _exhaustive: never = block
        return _exhaustive
      }
    }
  }
  return parts.join('\n\n')
}

async function prepareCodexInput(content: UserMessageContent): Promise<PreparedCodexInput> {
  if (typeof content === 'string') {
    return {
      input: content,
      cleanup: async () => {},
    }
  }

  const entries: Exclude<CodexInput, string> = []
  const userArgs = collectUserTextArgs(content)
  let tempDir: string | null = null
  let imageCounter = 0
  let hasLocalImage = false

  const cleanup = async (): Promise<void> => {
    if (!tempDir) return
    const dir = tempDir
    tempDir = null
    try {
      await rm(dir, { recursive: true, force: true })
    } catch {
      // best-effort cleanup; ignore failures
    }
  }

  for (const block of content) {
    switch (block.type) {
      case 'text':
        entries.push({ type: 'text', text: block.text })
        break
      case 'slash_command':
        for (const text of renderSlashCommandForCodex(block, userArgs)) {
          entries.push({ type: 'text', text })
        }
        break
      case 'image': {
        try {
          if (!tempDir) {
            tempDir = await mkdtemp(join(tmpdir(), 'opencow-codex-image-'))
          }
          imageCounter += 1
          const extension = imageExtensionFromMediaType(block.mediaType)
          const imagePath = join(tempDir, `attachment-${imageCounter}${extension}`)
          await writeFile(imagePath, Buffer.from(block.data, 'base64'))
          entries.push({ type: 'local_image', path: imagePath })
          hasLocalImage = true
        } catch (err) {
          log.warn(`Failed to materialize image attachment for Codex (${block.mediaType})`, err)
          entries.push({ type: 'text', text: `[Image omitted: ${block.mediaType}]` })
        }
        break
      }
      case 'document':
        if (block.mediaType === 'text/plain') {
          entries.push({ type: 'text', text: block.data })
        } else {
          const title = block.title ?? 'document'
          entries.push({ type: 'text', text: `[Document omitted: ${title} (${block.mediaType})]` })
        }
        break
      default: {
        const _exhaustive: never = block
        return _exhaustive
      }
    }
  }

  if (!hasLocalImage) {
    await cleanup()
    return {
      input: toCodexTextPrompt(content),
      cleanup: async () => {},
    }
  }

  return { input: entries, cleanup }
}

function isAbortError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code
  const name = (err as Error)?.name
  return name === 'AbortError' || code === 'ABORT_ERR'
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function toNonNegativeFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number') return null
  if (!Number.isFinite(value) || value < 0) return null
  return value
}

function toPositiveFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number') return null
  if (!Number.isFinite(value) || value <= 0) return null
  return value
}

function isCodexThreadEvent(value: unknown): value is ThreadEvent {
  const record = asObject(value)
  if (!record) return false
  const type = record.type
  return typeof type === 'string' && CODEX_THREAD_EVENT_TYPES.has(type)
}

type CodexTokenCountParseResult =
  | { kind: 'none' }
  | { kind: 'ok'; snapshotEvent: EngineRuntimeEvent }
  | { kind: 'malformed'; reason: string }

function parseCodexTokenCountSnapshot(value: unknown): CodexTokenCountParseResult {
  const envelope = asObject(value)
  if (!envelope || envelope.type !== 'event_msg') return { kind: 'none' }

  const payload = asObject(envelope.payload)
  if (!payload) return { kind: 'malformed', reason: 'event_msg.payload is missing or not an object' }
  if (payload.type !== 'token_count') return { kind: 'none' }

  const info = asObject(payload.info)
  if (!info) return { kind: 'malformed', reason: 'token_count payload.info is missing or not an object' }
  const lastTokenUsage = asObject(info?.last_token_usage)
  if (!lastTokenUsage) {
    return { kind: 'malformed', reason: 'token_count info.last_token_usage is missing or not an object' }
  }
  const usedTokensRaw = toNonNegativeFiniteNumber(lastTokenUsage?.input_tokens)
  const limitTokensRaw = toPositiveFiniteNumber(info?.model_context_window)
  if (usedTokensRaw == null || limitTokensRaw == null) {
    return {
      kind: 'malformed',
      reason: 'token_count missing valid numeric fields: last_token_usage.input_tokens/model_context_window',
    }
  }

  const usedTokens = Math.max(0, Math.trunc(usedTokensRaw))
  const limitTokens = Math.max(1, Math.trunc(limitTokensRaw))
  const remainingTokens = Math.max(0, limitTokens - usedTokens)
  const remainingPct = Math.max(0, Math.min(100, (remainingTokens / limitTokens) * 100))

  return {
    kind: 'ok',
    snapshotEvent: {
      kind: 'context.snapshot',
      payload: {
        usedTokens,
        limitTokens,
        remainingTokens,
        remainingPct,
        source: 'codex.token_count',
        confidence: 'authoritative',
      },
    },
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout?.()
          reject(new Error(timeoutMessage))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Codex SDK-backed lifecycle that emits engine-agnostic runtime events.
 *
 * It keeps a single Codex thread alive and executes one turn per queued message.
 */
export class CodexQueryLifecycle implements SessionLifecycle {
  private _stopped = false
  private readonly promptQueue = new AsyncPushQueue<UserMessageContent>()
  private readonly outputQueue = new AsyncPushQueue<EngineRuntimeEventEnvelope>()
  private doneResolve: (() => void) | null = null
  private readonly donePromise: Promise<void>

  private thread: Thread | null = null
  private model: string | undefined
  private worker: Promise<void> | null = null
  private activeTurnAbortController: AbortController | null = null
  private firstTurnSystemPrompt: string | null = null
  private startupOptions: ParsedCodexLifecycleOptions | null = null
  private nextTurnSeq = 1

  constructor() {
    this.donePromise = new Promise<void>((resolve) => {
      this.doneResolve = resolve
    })
  }

  get stopped(): boolean {
    return this._stopped
  }

  start(
    initialPrompt: UserMessageContent,
    rawOptions: Record<string, unknown>
  ): AsyncIterable<EngineRuntimeEventEnvelope> {
    if (this.worker) throw new Error('CodexQueryLifecycle already started')
    if (this._stopped) throw new Error('CodexQueryLifecycle already stopped')

    this.startupOptions = parseOptions(rawOptions)
    this.model = this.startupOptions.model
    this.firstTurnSystemPrompt = this.startupOptions.systemPrompt ?? null

    if (this.startupOptions.resume) {
      this.emitRuntimeEvent({
        kind: 'session.initialized',
        payload: {
          sessionRef: this.startupOptions.resume,
          model: this.model,
        },
      })
    }

    this.promptQueue.push(initialPrompt)
    this.worker = this.initializeAndProcessPromptQueue()
      .catch((err) => {
        log.error('Codex lifecycle worker failed', err)
        this.emitRuntimeEvent({
          kind: 'turn.result',
          payload: {
            outcome: 'execution_error',
            errors: [err instanceof Error ? err.message : String(err)],
          },
        })
      })
      .finally(() => {
        this._stopped = true
        this.promptQueue.close()
        this.outputQueue.close()
        this.doneResolve?.()
        this.doneResolve = null
      })

    return this.outputQueue
  }

  pushMessage(content: UserMessageContent): void {
    if (this._stopped) return
    this.promptQueue.push(content)
  }

  async stop(): Promise<void> {
    if (this._stopped) return
    this._stopped = true
    this.promptQueue.close()
    this.activeTurnAbortController?.abort()

    if (!this.worker) {
      this.outputQueue.close()
      this.doneResolve?.()
      this.doneResolve = null
      return
    }

    let timer: ReturnType<typeof setTimeout> | null = null
    await Promise.race([
      this.donePromise,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, STOP_SAFETY_TIMEOUT_MS)
      })
    ])
    if (timer) clearTimeout(timer)
  }

  private emitRuntimeEvent(event: EngineRuntimeEvent, params?: { turnRef?: RuntimeTurnRef }): void {
    this.outputQueue.push(createRuntimeEventEnvelope({
      engine: 'codex',
      event,
      turnRef: params?.turnRef,
    }))
  }

  private emitRuntimeEvents(events: EngineRuntimeEvent[], params?: { turnRef?: RuntimeTurnRef }): void {
    for (const event of events) {
      const normalizedEvent =
        event.kind === 'session.initialized' &&
        !event.payload.model &&
        this.model
          ? {
              ...event,
              payload: {
                ...event.payload,
                model: this.model,
              },
            }
          : event
      this.emitRuntimeEvent(
        normalizedEvent,
        isTurnScopedRuntimeEventKind(normalizedEvent.kind) ? { turnRef: params?.turnRef } : undefined,
      )
    }
  }

  private async processPromptQueue(): Promise<void> {
    while (!this._stopped) {
      const prompt = await this.promptQueue.shift()
      if (prompt === null) return
      await this.runTurn(prompt)
    }
  }

  private async initializeAndProcessPromptQueue(): Promise<void> {
    const options = this.startupOptions
    if (!options) throw new Error('Codex lifecycle missing startup options')

    const sdk = await withTimeout(
      codexSdkLoader(),
      STARTUP_BOOTSTRAP_TIMEOUT_MS,
      `Codex SDK bootstrap timed out after ${Math.floor(STARTUP_BOOTSTRAP_TIMEOUT_MS / 1000)}s while loading SDK module`,
    )

    if (options.pathOverride) {
      log.info(
        `Codex path override: ${options.pathOverride} (exists=${existsSync(options.pathOverride)})`,
      )
    }

    // ── Pre-flight config diagnostics ──────────────────────────────────
    //
    // Validate MCP server configs before passing them to the SDK:
    // - Verify that command executables exist on disk
    // - Verify that script arguments reference existing files
    // - Strip any invalid MCP servers to prevent silent binary crashes
    //
    const sanitizedConfig = options.codexConfig
      ? sanitizeCodexMcpConfig(options.codexConfig)
      : undefined

    log.info(
      `Codex SDK init: model=${options.model}, baseUrl=${options.baseUrl ?? '<unset>'}, ` +
        `apiKey=${options.apiKey ? `${options.apiKey.slice(0, 6)}...` : '<unset>'}, ` +
        `hasConfig=${!!sanitizedConfig}, ` +
        `configKeys=${sanitizedConfig ? Object.keys(sanitizedConfig).join(',') : 'none'}`,
    )

    // ── Env diagnostics ────────────────────────────────────────────────
    // Log all env var keys being passed to the Codex binary.
    // This is critical for diagnosing Electron-specific env leaks that
    // cause the binary or its MCP subprocesses to crash silently.
    if (options.env) {
      const envKeys = Object.keys(options.env).sort()
      log.info(`Codex env (${envKeys.length} keys): ${envKeys.join(', ')}`)
      // Highlight potentially problematic env vars
      const suspiciousKeys = envKeys.filter(
        (k) =>
          k.startsWith('ELECTRON_') ||
          k.startsWith('NODE_') ||
          k === 'NODE_OPTIONS' ||
          k.startsWith('DYLD_') ||
          k.startsWith('LD_'),
      )
      if (suspiciousKeys.length > 0) {
        log.warn(`Codex env contains potentially problematic keys: ${suspiciousKeys.join(', ')}`)
      }
    }

    if (sanitizedConfig) {
      logCodexConfigDiagnostics(sanitizedConfig)
    }

    const codex = new sdk.Codex({
      env: options.env,
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      ...(options.pathOverride ? { codexPathOverride: options.pathOverride } : {}),
      ...(sanitizedConfig ? { config: sanitizedConfig as Record<string, CodexConfigValue> } : {}),
    })

    const threadOptions = {
      model: options.model,
      workingDirectory: options.cwd,
      sandboxMode: options.sandboxMode ?? DEFAULT_SANDBOX_MODE,
      approvalPolicy: options.approvalPolicy ?? DEFAULT_APPROVAL_POLICY,
      skipGitRepoCheck: options.skipGitRepoCheck ?? true,
      ...(options.modelReasoningEffort ? { modelReasoningEffort: options.modelReasoningEffort } : {}),
    }

    this.thread = await withTimeout(
      Promise.resolve().then(() =>
        options.resume
          ? codex.resumeThread(options.resume!, threadOptions)
          : codex.startThread(threadOptions),
      ),
      STARTUP_BOOTSTRAP_TIMEOUT_MS,
      `Codex SDK bootstrap timed out after ${Math.floor(STARTUP_BOOTSTRAP_TIMEOUT_MS / 1000)}s while creating thread`,
    )

    await this.processPromptQueue()
  }

  private async runTurn(prompt: UserMessageContent): Promise<void> {
    const thread = this.thread
    if (!thread || this._stopped) return

    const adapter = new CodexRuntimeEventAdapter()
    const turnRef: RuntimeTurnRef = { turnSeq: this.nextTurnSeq++ }
    this.activeTurnAbortController = new AbortController()
    let preparedInput: PreparedCodexInput | null = null
    let lastErrorEventMessage: string | null = null

    let startupTimedOut = false
    const markStartupTimeout = (): void => {
      if (this._stopped) return
      startupTimedOut = true
      log.warn(`Codex turn startup timed out after ${STARTUP_EVENT_TIMEOUT_MS}ms — aborting turn`)
      this.activeTurnAbortController?.abort()
    }

    try {
      preparedInput = await prepareCodexInput(prompt)
      let turnInput: CodexInput = preparedInput.input
      if (this.firstTurnSystemPrompt) {
        if (typeof turnInput === 'string') {
          turnInput = `${this.firstTurnSystemPrompt}\n\n${turnInput}`
        } else {
          turnInput = [{ type: 'text', text: this.firstTurnSystemPrompt }, ...turnInput]
        }
      }
      this.firstTurnSystemPrompt = null

      // ── Prompt diagnostics ────────────────────────────────────────────
      // Log the prompt being sent to stdin to help reproduce binary crashes.
      if (typeof turnInput === 'string') {
        const preview =
          turnInput.length <= 400
            ? turnInput
            : `${turnInput.slice(0, 200)}...[${turnInput.length} chars]...${turnInput.slice(-100)}`
        log.info(`Codex stdin prompt (${turnInput.length} chars): ${preview.replace(/\n/g, '\\n')}`)
      } else {
        const textParts = turnInput.filter((p) => p.type === 'text')
        const totalLen = textParts.reduce(
          (sum, p) => sum + ((p as { text?: string }).text?.length ?? 0),
          0,
        )
        log.info(
          `Codex stdin prompt: ${turnInput.length} parts (${textParts.length} text, ${totalLen} total chars)`,
        )
      }

      const { events } = await withTimeout(
        thread.runStreamed(turnInput, {
          signal: this.activeTurnAbortController.signal,
        }),
        STARTUP_EVENT_TIMEOUT_MS,
        `Codex startup timed out after ${Math.floor(STARTUP_EVENT_TIMEOUT_MS / 1000)}s before stream initialization. Please verify provider auth/base URL/network and retry.`,
        markStartupTimeout,
      )

      const iter = events[Symbol.asyncIterator]()
      let firstEventReceived = false
      let tokenCountParseDiagnosticEmitted = false

      while (true) {
        const next = firstEventReceived
          ? await iter.next()
          : await withTimeout(
            iter.next(),
            STARTUP_EVENT_TIMEOUT_MS,
            `Codex startup timed out after ${Math.floor(STARTUP_EVENT_TIMEOUT_MS / 1000)}s waiting for first event. Please verify provider auth/base URL/network and retry.`,
            markStartupTimeout,
          )

        if (next.done) break
        firstEventReceived = true

        if (this._stopped) return

        const rawEvent: unknown = next.value
        const tokenCountResult = parseCodexTokenCountSnapshot(rawEvent)
        if (tokenCountResult.kind === 'ok') {
          this.emitRuntimeEvent(tokenCountResult.snapshotEvent)
        } else if (tokenCountResult.kind === 'malformed' && !tokenCountParseDiagnosticEmitted) {
          tokenCountParseDiagnosticEmitted = true
          this.emitRuntimeEvent({
            kind: 'engine.diagnostic',
            payload: {
              code: 'codex.token_count_unparseable',
              severity: 'warning',
              message: `Malformed Codex token_count event: ${tokenCountResult.reason}`,
              terminal: false,
              source: 'codex.token_count',
            },
          })
        }

        if (!isCodexThreadEvent(rawEvent)) {
          continue
        }

        // Track error events so we can surface real error details if the binary
        // exits with a non-zero code (its stderr is usually uninformative).
        const typedEvent = rawEvent as { type: string; message?: string }
        if (typedEvent.type === 'error' && typeof typedEvent.message === 'string') {
          lastErrorEventMessage = typedEvent.message
        }

        const adapted = adapter.adapt(rawEvent)
        this.emitRuntimeEvents(adapted.events, { turnRef })
      }
    } catch (err) {
      if (this._stopped && isAbortError(err)) return

      log.error('Codex turn execution failed', err)
      let message: string
      if (startupTimedOut) {
        message = `Codex startup timed out after ${Math.floor(STARTUP_EVENT_TIMEOUT_MS / 1000)}s. Please verify provider auth/base URL/network and retry.`
      } else if (lastErrorEventMessage) {
        // The binary's stderr typically only contains a generic status line
        // (e.g. "Reading prompt from stdin..."). The actual error details are
        // delivered via stdout JSON error events — prefer those for the user-facing
        // message so the root cause (e.g. 503, auth failure) is visible.
        message = lastErrorEventMessage
      } else {
        message = err instanceof Error ? err.message : String(err)
      }

      this.emitRuntimeEvents(adapter.emitUnexpectedTurnEnd(message), { turnRef })
      return
    } finally {
      await preparedInput?.cleanup()
      this.activeTurnAbortController = null
    }

    if (!this._stopped && !adapter.didEmitResult()) {
      this.emitRuntimeEvents(adapter.emitUnexpectedTurnEnd('Codex turn ended unexpectedly'), { turnRef })
    }
  }
}

// ── Config diagnostics & sanitization (exported for testing) ───────────

/**
 * Log diagnostic details about the codex config that will be serialized
 * to `--config` CLI flags by the SDK.
 *
 * This is invaluable for diagnosing binary crashes caused by invalid
 * config serialization — the log output can be used to reconstruct the
 * exact CLI invocation for manual testing.
 */
function logCodexConfigDiagnostics(config: CodexConfigObject): void {
  try {
    // Log model_provider / model_providers (if any)
    const modelProvider = config.model_provider
    if (modelProvider) {
      log.info(`Codex config: model_provider=${JSON.stringify(modelProvider)}`)
    }

    // Log MCP server names and their commands
    const mcpServers = config.mcp_servers
    if (mcpServers && typeof mcpServers === 'object' && !Array.isArray(mcpServers)) {
      const entries = Object.entries(mcpServers as Record<string, unknown>)
      for (const [name, serverConfig] of entries) {
        if (!serverConfig || typeof serverConfig !== 'object') continue
        const sc = serverConfig as Record<string, unknown>
        const command = typeof sc.command === 'string' ? sc.command : '<missing>'
        const args = Array.isArray(sc.args) ? sc.args : []
        const envKeys = sc.env && typeof sc.env === 'object'
          ? Object.keys(sc.env as Record<string, unknown>)
          : []
        const commandExists = typeof sc.command === 'string' ? existsSync(sc.command) : false
        const scriptPath = args.length > 0 && typeof args[0] === 'string' ? args[0] : null
        const scriptExists = scriptPath ? existsSync(scriptPath) : null

        log.info(
          `Codex MCP server "${name}": command=${command} (exists=${commandExists}), ` +
            `args=${JSON.stringify(args)}, ` +
            `scriptExists=${scriptExists ?? 'n/a'}, ` +
            `envKeys=[${envKeys.join(',')}]`,
        )
      }
    }

    // ── Serialized --config args diagnostic ────────────────────────────
    // Replicate the SDK's flattenConfigOverrides + toTomlValue so we can
    // log the EXACT --config flags the binary will receive. This enables
    // manual reproduction: `echo "hi" | CODEX_API_KEY=... /path/to/codex exec --experimental-json --config '...' ...`
    const serialized = serializeConfigForDiagnostic(config)
    if (serialized.length > 0) {
      log.info(`Codex --config overrides (${serialized.length} entries):`)
      for (const entry of serialized) {
        log.info(`  --config '${entry}'`)
      }
    }
  } catch (err) {
    log.warn('Failed to log Codex config diagnostics', err)
  }
}

// ── SDK-compatible config serialization (for diagnostics only) ──────────

const TOML_BARE_KEY_RE = /^[A-Za-z0-9_-]+$/

function formatTomlKeyDiag(key: string): string {
  return TOML_BARE_KEY_RE.test(key) ? key : JSON.stringify(key)
}

function toTomlValueDiag(value: unknown, path: string): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') return `${value}`
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) {
    return `[${value.map((item, i) => toTomlValueDiag(item, `${path}[${i}]`)).join(', ')}]`
  }
  if (value !== null && typeof value === 'object') {
    const parts = Object.entries(value as Record<string, unknown>)
      .filter(([k, v]) => k && v !== undefined)
      .map(([k, v]) => `${formatTomlKeyDiag(k)} = ${toTomlValueDiag(v, `${path}.${k}`)}`)
    return `{${parts.join(', ')}}`
  }
  return 'null'
}

function flattenConfigDiag(value: unknown, prefix: string, overrides: string[]): void {
  if (value === null || value === undefined) return
  if (typeof value !== 'object' || Array.isArray(value)) {
    if (prefix) overrides.push(`${prefix}=${toTomlValueDiag(value, prefix)}`)
    return
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (prefix && entries.length === 0) {
    overrides.push(`${prefix}={}`)
    return
  }
  for (const [key, child] of entries) {
    if (!key || child === undefined) continue
    const path = prefix ? `${prefix}.${key}` : key
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      flattenConfigDiag(child, path, overrides)
    } else {
      overrides.push(`${path}=${toTomlValueDiag(child, path)}`)
    }
  }
}

function serializeConfigForDiagnostic(config: CodexConfigObject): string[] {
  const overrides: string[] = []
  flattenConfigDiag(config, '', overrides)
  return overrides
}

/**
 * Validate and sanitize the Codex config's `mcp_servers` section before
 * passing it to the SDK.
 *
 * The Codex binary may crash silently (exit code 1, no stdout events)
 * when the config references MCP server scripts that don't exist on disk.
 * This function removes invalid entries and logs warnings, ensuring the
 * binary can at least start and process the prompt without MCP tools.
 */
export function sanitizeCodexMcpConfig(config: CodexConfigObject): CodexConfigObject {
  const mcpServers = config.mcp_servers
  if (!mcpServers || typeof mcpServers !== 'object' || Array.isArray(mcpServers)) {
    return config
  }

  const entries = Object.entries(mcpServers as Record<string, unknown>)
  if (entries.length === 0) return config

  const validServers: Record<string, unknown> = {}
  let removedCount = 0

  for (const [name, serverConfig] of entries) {
    if (!serverConfig || typeof serverConfig !== 'object' || Array.isArray(serverConfig)) {
      continue
    }
    const sc = serverConfig as Record<string, unknown>

    // Validate command exists
    if (typeof sc.command === 'string' && sc.command.length > 0) {
      if (!existsSync(sc.command)) {
        log.warn(
          `Codex MCP server "${name}": command "${sc.command}" does not exist on disk — removing from config`,
        )
        removedCount++
        continue
      }
    }

    // Validate script arg exists (first arg is typically the script path)
    if (Array.isArray(sc.args) && sc.args.length > 0) {
      const firstArg = sc.args[0]
      if (typeof firstArg === 'string' && firstArg.startsWith('/') && !existsSync(firstArg)) {
        log.warn(
          `Codex MCP server "${name}": script "${firstArg}" does not exist on disk — removing from config`,
        )
        removedCount++
        continue
      }
    }

    validServers[name] = serverConfig
  }

  if (removedCount === 0) return config

  log.warn(`Removed ${removedCount} invalid MCP server(s) from Codex config`)

  if (Object.keys(validServers).length === 0) {
    // All MCP servers were invalid — remove the mcp_servers key entirely
    const { mcp_servers: _removed, ...rest } = config
    return rest as CodexConfigObject
  }

  return { ...config, mcp_servers: validServers }
}
