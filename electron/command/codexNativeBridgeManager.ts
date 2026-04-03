// SPDX-License-Identifier: Apache-2.0

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createLogger } from '../platform/logger'
import type { NativeCapabilityRegistry } from '../nativeCapabilities/registry'
import type { NativeCapabilityToolContext, NativeToolDescriptor } from '../nativeCapabilities/types'
import type { ToolProgressRelay } from '../utils/toolProgressRelay'
import { MCP_SERVER_BASE_NAME } from '@shared/appIdentity'
import { z } from 'zod/v4'
import type { CodexMcpServerMap } from './codexMcpConfigBuilder'
import {
  buildCodexNativeBridgeStdioScript,
  type CodexNativeBridgeStdioModules,
} from './codexNativeBridgeStdioScript'
import { getElectronAsNodePath, buildAsarAwareEnv } from '../platform/electronSpawn'
import type { StartSessionNativeToolAllowItem } from '../../src/shared/types'

const log = createLogger('CodexNativeBridgeManager')

const BRIDGE_ROUTE_PREFIX = '/codex-native'
const BRIDGE_LIST_TOOLS_PATH = `${BRIDGE_ROUTE_PREFIX}/list-tools`
const BRIDGE_CALL_TOOL_PATH = `${BRIDGE_ROUTE_PREFIX}/call-tool`
const BRIDGE_TOKEN_HEADER = 'x-opencow-bridge-token'
const BRIDGE_SCRIPT_DIR = path.join(os.tmpdir(), 'opencow-codex-native-bridge')
const BRIDGE_SCRIPT_PATH = path.join(BRIDGE_SCRIPT_DIR, 'stdio-bridge.cjs')
const BRIDGE_MAX_JSON_BODY_BYTES = 512 * 1024
const BRIDGE_TOOL_TIMEOUT_MS = 10 * 60_000
const MCP_SERVER_MODULE_SPECIFIER = '@modelcontextprotocol/sdk/server/mcp.js'
const MCP_STDIO_TRANSPORT_MODULE_SPECIFIER = '@modelcontextprotocol/sdk/server/stdio.js'
const ZOD_V4_MODULE_SPECIFIER = 'zod/v4'

interface BridgeSessionEntry {
  token: string
  tools: Map<string, NativeToolDescriptor>
}

interface BridgeErrorPayload {
  code: string
  message: string
}

class BridgeHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface RegisterCodexBridgeSessionInput {
  session: {
    sessionId: string
    projectId: string | null
    originSource: string
  }
  relay: ToolProgressRelay
  nativeToolAllowlist: StartSessionNativeToolAllowItem[]
  activeMcpServerNames?: ReadonlySet<string>
  /**
   * Additional per-session tool descriptors to merge with registry tools.
   * Used for per-session sandboxed tools (e.g. RepoAnalyzer's filesystem tools)
   * that can't be registered globally in NativeCapabilityRegistry.
   */
  additionalTools?: NativeToolDescriptor[]
}

interface CodexNativeBridgeManagerOptions {
  resolveBridgeCommand?: () => string
}

function optionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function resolveBridgeCommandDefault(): string {
  return getElectronAsNodePath()
}

/**
 * CodexNativeBridgeManager
 *
 * Exposes OpenCow native capabilities to Codex as a stdio MCP server command.
 * The command process talks back to this manager over loopback HTTP for:
 * - list-tools
 * - call-tool
 */
export class CodexNativeBridgeManager {
  private readonly sessions = new Map<string, BridgeSessionEntry>()
  private server: Server | null = null
  private port: number | null = null
  private readonly resolveBridgeCommand: () => string

  constructor(
    private readonly nativeCapabilityRegistry: NativeCapabilityRegistry,
    options: CodexNativeBridgeManagerOptions = {},
  ) {
    this.resolveBridgeCommand = options.resolveBridgeCommand ?? resolveBridgeCommandDefault
  }

  async registerSession(input: RegisterCodexBridgeSessionInput): Promise<CodexMcpServerMap | undefined> {
    const { sessionId } = input.session

    if (input.activeMcpServerNames?.has(MCP_SERVER_BASE_NAME)) {
      log.warn(
        `Skipped native bridge registration for session ${sessionId}: MCP server name "${MCP_SERVER_BASE_NAME}" already active`,
      )
      return undefined
    }

    const toolContext: NativeCapabilityToolContext = {
      session: input.session,
      relay: input.relay,
      activeMcpServerNames: input.activeMcpServerNames,
    }

    const registryTools = this.nativeCapabilityRegistry.getToolDescriptorsByAllowlist(input.nativeToolAllowlist, toolContext)
    const tools = input.additionalTools
      ? [...registryTools, ...input.additionalTools]
      : registryTools

    if (tools.length === 0) {
      this.sessions.delete(sessionId)
      return undefined
    }

    try {
      await this.ensureHttpServer()
      const scriptPath = await this.ensureBridgeScript()
      const token = randomUUID()
      const toolMap = toToolMapOrThrow(tools)
      this.sessions.set(sessionId, {
        token,
        tools: toolMap,
      })

      const env = buildAsarAwareEnv({
        OPENCOW_CODEX_BRIDGE_URL: `http://127.0.0.1:${this.port}`,
        OPENCOW_CODEX_BRIDGE_TOKEN: token,
        OPENCOW_CODEX_BRIDGE_SESSION_ID: sessionId,
      })
      const bridgeCommand = this.resolveBridgeCommand()

      log.info(
        `Registered Codex native bridge session ${sessionId} with ${tools.length} tools ` +
          `(command=${bridgeCommand}, script=${scriptPath}, port=${this.port})`,
      )
      return {
        [MCP_SERVER_BASE_NAME]: {
          command: bridgeCommand,
          args: [scriptPath],
          env,
        },
      }
    } catch (err) {
      log.warn(
        `Failed to register Codex native bridge for session ${sessionId}; falling back to prompt-only capabilities`,
        err,
      )
      this.sessions.delete(sessionId)
      if (this.sessions.size === 0) {
        await this.closeHttpServer().catch(() => {})
      }
      return undefined
    }
  }

  async unregisterSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId)
    if (this.sessions.size === 0) {
      await this.closeHttpServer()
    }
  }

  async dispose(): Promise<void> {
    this.sessions.clear()
    await this.closeHttpServer()
  }

  private async ensureHttpServer(): Promise<void> {
    if (this.server && this.port !== null) return

    this.server = createServer((req, res) => {
      void this.handleRequest(req, res)
    })

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(0, '127.0.0.1', () => {
        const address = this.server!.address()
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to start Codex native bridge HTTP server: invalid address'))
          return
        }
        this.port = address.port
        this.server!.off('error', reject)
        resolve()
      })
    })
  }

  private async closeHttpServer(): Promise<void> {
    if (!this.server) return
    const server = this.server
    this.server = null
    this.port = null
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  }

  private async ensureBridgeScript(): Promise<string> {
    const script = buildCodexNativeBridgeStdioScript(this.resolveBridgeScriptModules())
    await fs.mkdir(BRIDGE_SCRIPT_DIR, { recursive: true })
    const existing = await fs.readFile(BRIDGE_SCRIPT_PATH, 'utf-8').catch(() => null)
    if (existing !== script) {
      await fs.writeFile(BRIDGE_SCRIPT_PATH, script, 'utf-8')
      await fs.chmod(BRIDGE_SCRIPT_PATH, 0o755).catch(() => {})
    }

    // Post-write verification: ensure the script actually exists on disk.
    // This guards against silent write failures (permissions, disk full, etc.).
    try {
      await fs.access(BRIDGE_SCRIPT_PATH)
    } catch {
      throw new Error(
        `Bridge script was written but is not accessible at ${BRIDGE_SCRIPT_PATH}`,
      )
    }

    return BRIDGE_SCRIPT_PATH
  }

  private resolveBridgeScriptModules(): CodexNativeBridgeStdioModules {
    return {
      mcpServerModulePath: require.resolve(MCP_SERVER_MODULE_SPECIFIER),
      stdioServerTransportModulePath: require.resolve(MCP_STDIO_TRANSPORT_MODULE_SPECIFIER),
      zodModulePath: require.resolve(ZOD_V4_MODULE_SPECIFIER),
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method === 'GET' && url.pathname === BRIDGE_LIST_TOOLS_PATH) {
        const sessionId = url.searchParams.get('sessionId')
        if (!sessionId) {
          this.sendError(res, 400, { code: 'invalid_request', message: 'Missing sessionId' })
          return
        }
        const entry = this.getAuthorizedSession(req, sessionId)
        if (!entry) {
          this.sendError(res, 403, { code: 'forbidden', message: 'Forbidden' })
          return
        }
        this.sendJson(res, 200, {
          tools: [...entry.tools.values()].map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: serializeToolInputSchema(tool),
          })),
        })
        return
      }

      if (req.method === 'POST' && url.pathname === BRIDGE_CALL_TOOL_PATH) {
        const payload = await this.readJsonBody(req, BRIDGE_MAX_JSON_BODY_BYTES)
        const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : null
        const name = typeof payload.name === 'string' ? payload.name : null
        const args = payload.args
        const toolUseId = optionalNonEmptyString(payload.toolUseId)
        const invocationId = optionalNonEmptyString(payload.invocationId) ?? toolUseId
        if (!sessionId || !name) {
          this.sendError(res, 400, { code: 'invalid_request', message: 'Missing sessionId or tool name' })
          return
        }
        const entry = this.getAuthorizedSession(req, sessionId)
        if (!entry) {
          this.sendError(res, 403, { code: 'forbidden', message: 'Forbidden' })
          return
        }
        const tool = entry.tools.get(name)
        if (!tool) {
          this.sendError(res, 404, { code: 'tool_not_found', message: `Tool not found: ${name}` })
          return
        }
        const validatedArgs = validateToolArgs(tool, args)

        const result = await withTimeout(
          (signal, deadlineAt) =>
            tool.execute({
              args: validatedArgs,
              context: {
                signal,
                deadlineAt,
                engine: 'codex',
                toolUseId,
                invocationId,
              },
            }),
          BRIDGE_TOOL_TIMEOUT_MS,
          `Tool execution timed out after ${Math.floor(BRIDGE_TOOL_TIMEOUT_MS / 1000)}s: ${name}`,
        )
        this.sendJson(res, 200, { result })
        return
      }

      this.sendError(res, 404, { code: 'not_found', message: 'Not found' })
    } catch (err) {
      if (err instanceof BridgeHttpError) {
        this.sendError(res, err.status, { code: err.code, message: err.message })
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      this.sendError(res, 500, { code: 'internal_error', message })
    }
  }

  private isAuthorized(req: IncomingMessage, expectedToken: string): boolean {
    const headerToken = req.headers[BRIDGE_TOKEN_HEADER]
    if (Array.isArray(headerToken)) return headerToken.includes(expectedToken)
    return headerToken === expectedToken
  }

  private getAuthorizedSession(req: IncomingMessage, sessionId: string): BridgeSessionEntry | null {
    const entry = this.sessions.get(sessionId)
    if (!entry) return null
    return this.isAuthorized(req, entry.token) ? entry : null
  }

  private async readJsonBody(req: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []
    let totalBytes = 0
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      totalBytes += buffer.length
      if (totalBytes > maxBytes) {
        throw new BridgeHttpError(413, 'payload_too_large', `JSON payload exceeds limit (${maxBytes} bytes)`)
      }
      chunks.push(buffer)
    }
    const raw = Buffer.concat(chunks).toString('utf-8')
    if (!raw) return {}
    try {
      const parsed = JSON.parse(raw) as unknown
      return asRecord(parsed)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid JSON payload'
      throw new BridgeHttpError(400, 'invalid_json', message)
    }
  }

  private sendJson(res: ServerResponse, status: number, payload: unknown): void {
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(payload))
  }

  private sendError(res: ServerResponse, status: number, error: BridgeErrorPayload): void {
    this.sendJson(res, status, { error })
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function serializeToolInputSchema(tool: NativeToolDescriptor): Record<string, unknown> {
  try {
    // z.object() default (strip mode) and .strict() both emit identical JSON Schema
    // (additionalProperties: false). Removing .strict() avoids semantic confusion.
    return z.toJSONSchema(z.object(tool.inputSchema)) as Record<string, unknown>
  } catch (err) {
    const details = err instanceof Error ? err.message : String(err)
    log.warn(`Failed to serialize input schema for tool ${tool.name}; falling back to empty object schema`, details)
    return { type: 'object', properties: {}, additionalProperties: false }
  }
}

function validateToolArgs(tool: NativeToolDescriptor, rawArgs: unknown): Record<string, unknown> {
  // Use default strip mode (not .strict()) so unknown properties are silently removed
  // rather than triggering validation errors. This is safer for tool dispatch — SDK or
  // model may inject metadata fields (plan, _meta) that the tool schema doesn't declare.
  const parseResult = z.object(tool.inputSchema).safeParse(rawArgs ?? {})
  if (!parseResult.success) {
    const details = parseResult.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
        return `${path}: ${issue.message}`
      })
      .join('; ')
    throw new BridgeHttpError(
      400,
      'invalid_tool_arguments',
      `Invalid arguments for tool "${tool.name}": ${details}`,
    )
  }
  return parseResult.data as Record<string, unknown>
}

async function withTimeout<T>(
  run: (signal: AbortSignal, deadlineAt: number) => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  const controller = new AbortController()
  const deadlineAt = Date.now() + timeoutMs
  const timeoutError = new BridgeHttpError(504, 'tool_timeout', message)
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      run(controller.signal, deadlineAt).catch((err) => {
        if (timedOut) throw timeoutError
        throw err
      }),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true
          controller.abort(timeoutError)
          reject(timeoutError)
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function toToolMapOrThrow(tools: NativeToolDescriptor[]): Map<string, NativeToolDescriptor> {
  const map = new Map<string, NativeToolDescriptor>()
  const duplicates: string[] = []
  for (const tool of tools) {
    if (map.has(tool.name)) {
      duplicates.push(tool.name)
      continue
    }
    map.set(tool.name, tool)
  }
  if (duplicates.length > 0) {
    const uniqueNames = [...new Set(duplicates)].sort()
    throw new Error(`Duplicate native tool names are not allowed: ${uniqueNames.join(', ')}`)
  }
  return map
}
