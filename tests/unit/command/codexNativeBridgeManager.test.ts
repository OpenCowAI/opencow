// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod/v4'

vi.mock('electron', () => ({
  app: { isPackaged: false },
}))
import {
  CodexNativeBridgeManager,
} from '../../../electron/command/codexNativeBridgeManager'
import { ToolProgressRelay } from '../../../electron/utils/toolProgressRelay'
import { MCP_SERVER_BASE_NAME } from '../../../src/shared/appIdentity'

function makeTool(name: string, description: string, inputSchema: Record<string, unknown> = {}) {
  return {
    name,
    description,
    inputSchema,
    execute: async (input: { args: Record<string, unknown> }) => ({
      content: [{ type: 'text', text: `${name}:${JSON.stringify(input.args)}` }],
    }),
  }
}

function makeRegistryStub() {
  const projectTool = makeTool('list_projects', 'List projects')
  const issueTool = makeTool('list_issues', 'List issues')
  return {
    getAllToolDescriptors: () => [projectTool, issueTool],
    getToolDescriptorsByAllowlist: (allowlist: Array<{ capability: string }>) => {
      if (allowlist.some((item) => item.capability === 'projects')) return [projectTool]
      return []
    },
  }
}

function makeHtmlRegistryStub() {
  const htmlTool = makeTool('gen_html', 'Generate HTML preview')
  return {
    getAllToolDescriptors: () => [htmlTool],
    getToolDescriptorsByAllowlist: (allowlist: Array<{ capability: string }>) => {
      if (allowlist.some((item) => item.capability === 'html')) return [htmlTool]
      return []
    },
  }
}

const PROJECT_ALLOWLIST = [{ capability: 'projects' }]
const HTML_ALLOWLIST = [{ capability: 'html' }]
const CUSTOM_ALLOWLIST = [{ capability: 'custom' }]

function makeGetRequest(path: string, token: string): IncomingMessage {
  return {
    method: 'GET',
    url: path,
    headers: {
      'x-opencow-bridge-token': token,
    },
  } as IncomingMessage
}

function makePostRequest(path: string, token: string, chunks: Array<string | Buffer>): IncomingMessage {
  return {
    method: 'POST',
    url: path,
    headers: {
      'x-opencow-bridge-token': token,
    },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk
      }
    },
  } as unknown as IncomingMessage
}

function makeResponseRecorder(): ServerResponse & {
  body: string
  headerMap: Record<string, string>
} {
  const headerMap: Record<string, string> = {}
  return {
    statusCode: 0,
    body: '',
    headerMap,
    setHeader: (name: string, value: string) => {
      headerMap[name] = value
      return undefined
    },
    end: function end(payload?: string) {
      if (typeof payload === 'string') this.body += payload
      return this
    },
  } as unknown as ServerResponse & { body: string; headerMap: Record<string, string> }
}

describe('CodexNativeBridgeManager', () => {
  const managers: CodexNativeBridgeManager[] = []

  afterEach(async () => {
    for (const manager of managers.splice(0, managers.length)) {
      await manager.dispose()
    }
  })

  it('registers a session and returns codex MCP command config', async () => {
    const manager = new CodexNativeBridgeManager(makeRegistryStub() as never)
    managers.push(manager)
    ;(manager as unknown as { ensureHttpServer: () => Promise<void> }).ensureHttpServer = async () => {
      ;(manager as unknown as { port: number }).port = 39001
    }
    ;(manager as unknown as { ensureBridgeScript: () => Promise<string> }).ensureBridgeScript = async () =>
      '/tmp/opencow-codex-native-bridge.mjs'

    const sessionId = 'session-bridge-1'
    const serverConfigMap = await manager.registerSession({
      session: { sessionId, projectId: null, originSource: 'agent' },
      relay: new ToolProgressRelay(),
      nativeToolAllowlist: PROJECT_ALLOWLIST,
    })

    expect(serverConfigMap).toBeTruthy()
    const serverConfig = (serverConfigMap as Record<string, Record<string, unknown>>)[MCP_SERVER_BASE_NAME]
    expect(serverConfig).toBeTruthy()
    expect(serverConfig.command).toBe(process.execPath)
    expect(serverConfig.args).toEqual(['/tmp/opencow-codex-native-bridge.mjs'])

    const env = serverConfig.env as Record<string, string>
    const baseUrl = env.OPENCOW_CODEX_BRIDGE_URL
    const token = env.OPENCOW_CODEX_BRIDGE_TOKEN
    expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(token.length).toBeGreaterThan(10)

    await manager.unregisterSession(sessionId)
  })

  it('uses resolved node command for bridge process launch', async () => {
    const manager = new CodexNativeBridgeManager(makeRegistryStub() as never, {
      resolveBridgeCommand: () => '/custom/node/bin/node',
    })
    managers.push(manager)
    ;(manager as unknown as { ensureHttpServer: () => Promise<void> }).ensureHttpServer = async () => {
      ;(manager as unknown as { port: number }).port = 39012
    }
    ;(manager as unknown as { ensureBridgeScript: () => Promise<string> }).ensureBridgeScript = async () =>
      '/tmp/opencow-codex-native-bridge.mjs'

    const sessionId = 'session-bridge-node-command'
    const serverConfigMap = await manager.registerSession({
      session: { sessionId, projectId: null, originSource: 'agent' },
      relay: new ToolProgressRelay(),
      nativeToolAllowlist: PROJECT_ALLOWLIST,
    })

    const serverConfig = (serverConfigMap as Record<string, Record<string, unknown>>)[MCP_SERVER_BASE_NAME]
    expect(serverConfig.command).toBe('/custom/node/bin/node')
    expect(serverConfig.args).toEqual(['/tmp/opencow-codex-native-bridge.mjs'])
  })

  it('includes required bridge env vars in MCP server config', async () => {
    const manager = new CodexNativeBridgeManager(makeRegistryStub() as never)
    managers.push(manager)
    ;(manager as unknown as { ensureHttpServer: () => Promise<void> }).ensureHttpServer = async () => {
      ;(manager as unknown as { port: number }).port = 39013
    }
    ;(manager as unknown as { ensureBridgeScript: () => Promise<string> }).ensureBridgeScript = async () =>
      '/tmp/opencow-codex-native-bridge.mjs'

    const sessionId = 'session-bridge-env'
    const serverConfigMap = await manager.registerSession({
      session: { sessionId, projectId: null, originSource: 'agent' },
      relay: new ToolProgressRelay(),
      nativeToolAllowlist: PROJECT_ALLOWLIST,
    })

    expect(serverConfigMap).toBeDefined()
    const serverConfig = serverConfigMap![MCP_SERVER_BASE_NAME]
    expect(serverConfig.env).toHaveProperty('OPENCOW_CODEX_BRIDGE_URL')
    expect(serverConfig.env).toHaveProperty('OPENCOW_CODEX_BRIDGE_TOKEN')
    expect(serverConfig.env).toHaveProperty('OPENCOW_CODEX_BRIDGE_SESSION_ID')
  })

  it('issues unique per-session bridge tokens', async () => {
    const manager = new CodexNativeBridgeManager(makeRegistryStub() as never)
    managers.push(manager)
    ;(manager as unknown as { ensureHttpServer: () => Promise<void> }).ensureHttpServer = async () => {
      ;(manager as unknown as { port: number }).port = 39002
    }
    ;(manager as unknown as { ensureBridgeScript: () => Promise<string> }).ensureBridgeScript = async () =>
      '/tmp/opencow-codex-native-bridge.mjs'

    const serverConfigMap1 = await manager.registerSession({
      session: { sessionId: 'session-bridge-token-1', projectId: null, originSource: 'agent' },
      relay: new ToolProgressRelay(),
      nativeToolAllowlist: PROJECT_ALLOWLIST,
    })
    const serverConfigMap2 = await manager.registerSession({
      session: { sessionId: 'session-bridge-token-2', projectId: null, originSource: 'agent' },
      relay: new ToolProgressRelay(),
      nativeToolAllowlist: PROJECT_ALLOWLIST,
    })

    const token1 = ((serverConfigMap1 as Record<string, Record<string, unknown>>)[MCP_SERVER_BASE_NAME]
      .env as Record<string, string>).OPENCOW_CODEX_BRIDGE_TOKEN
    const token2 = ((serverConfigMap2 as Record<string, Record<string, unknown>>)[MCP_SERVER_BASE_NAME]
      .env as Record<string, string>).OPENCOW_CODEX_BRIDGE_TOKEN

    expect(token1).not.toBe(token2)
  })

  it('returns undefined when native-tool allowlist resolves to no tools', async () => {
    const manager = new CodexNativeBridgeManager(makeRegistryStub() as never)
    managers.push(manager)

    const serverConfigMap = await manager.registerSession({
      session: { sessionId: 'session-bridge-empty', projectId: null, originSource: 'agent' },
      relay: new ToolProgressRelay(),
      nativeToolAllowlist: [{ capability: 'browser' }],
    })

    expect(serverConfigMap).toBeUndefined()
  })

  it('exposes gen_html for codex bridge when html capability is enabled', async () => {
    const manager = new CodexNativeBridgeManager(makeHtmlRegistryStub() as never)
    managers.push(manager)
    ;(manager as unknown as { ensureHttpServer: () => Promise<void> }).ensureHttpServer = async () => {
      ;(manager as unknown as { port: number }).port = 39011
    }
    ;(manager as unknown as { ensureBridgeScript: () => Promise<string> }).ensureBridgeScript = async () =>
      '/tmp/opencow-codex-native-bridge.mjs'

    const sessionId = 'session-bridge-html'
    const serverConfigMap = await manager.registerSession({
      session: { sessionId, projectId: null, originSource: 'agent' },
      relay: new ToolProgressRelay(),
      nativeToolAllowlist: HTML_ALLOWLIST,
    })
    expect(serverConfigMap).toBeTruthy()

    const env = ((serverConfigMap as Record<string, Record<string, unknown>>)[MCP_SERVER_BASE_NAME]
      .env as Record<string, string>)
    const req = makeGetRequest(`/codex-native/list-tools?sessionId=${encodeURIComponent(sessionId)}`, env.OPENCOW_CODEX_BRIDGE_TOKEN)
    const res = makeResponseRecorder()

    await (manager as unknown as {
      handleRequest: (req: IncomingMessage, res: ServerResponse) => Promise<void>
    }).handleRequest(req, res)

    expect(res.statusCode).toBe(200)
    const payload = JSON.parse(res.body) as {
      tools: Array<{ name: string; inputSchema?: Record<string, unknown> }>
    }
    expect(payload.tools.map((tool) => tool.name)).toContain('gen_html')
    const htmlTool = payload.tools.find((tool) => tool.name === 'gen_html')
    expect(htmlTool?.inputSchema?.type).toBe('object')
    expect(htmlTool?.inputSchema?.properties).toBeTruthy()
  })

  it('serializes zod constraints in list-tools schema payload', async () => {
    const constrainedTools = [
      makeTool(
        'search_docs',
        'Search docs',
        {
          query: z.string().min(3).max(128),
        },
      ),
    ]
    const constrainedRegistry = {
      getAllToolDescriptors: () => constrainedTools,
      getToolDescriptorsByAllowlist: () => constrainedTools,
    }
    const manager = new CodexNativeBridgeManager(constrainedRegistry as never)
    managers.push(manager)
    ;(manager as unknown as { ensureHttpServer: () => Promise<void> }).ensureHttpServer = async () => {
      ;(manager as unknown as { port: number }).port = 39014
    }
    ;(manager as unknown as { ensureBridgeScript: () => Promise<string> }).ensureBridgeScript = async () =>
      '/tmp/opencow-codex-native-bridge.mjs'

    const sessionId = 'session-bridge-schema-constraints'
    const serverConfigMap = await manager.registerSession({
      session: { sessionId, projectId: null, originSource: 'agent' },
      relay: new ToolProgressRelay(),
      nativeToolAllowlist: CUSTOM_ALLOWLIST,
    })
    expect(serverConfigMap).toBeTruthy()

    const env = ((serverConfigMap as Record<string, Record<string, unknown>>)[MCP_SERVER_BASE_NAME]
      .env as Record<string, string>)
    const req = makeGetRequest(`/codex-native/list-tools?sessionId=${encodeURIComponent(sessionId)}`, env.OPENCOW_CODEX_BRIDGE_TOKEN)
    const res = makeResponseRecorder()

    await (manager as unknown as {
      handleRequest: (req: IncomingMessage, res: ServerResponse) => Promise<void>
    }).handleRequest(req, res)

    expect(res.statusCode).toBe(200)
    const payload = JSON.parse(res.body) as {
      tools: Array<{ name: string; inputSchema?: { properties?: Record<string, { minLength?: number; maxLength?: number }> } }>
    }
    const tool = payload.tools.find((item) => item.name === 'search_docs')
    expect(tool?.inputSchema?.properties?.query?.minLength).toBe(3)
    expect(tool?.inputSchema?.properties?.query?.maxLength).toBe(128)
  })

  it('returns undefined when bridge server name is already active', async () => {
    const manager = new CodexNativeBridgeManager(makeRegistryStub() as never)
    managers.push(manager)

    const serverConfigMap = await manager.registerSession({
      session: { sessionId: 'session-bridge-collide', projectId: null, originSource: 'agent' },
      relay: new ToolProgressRelay(),
      nativeToolAllowlist: PROJECT_ALLOWLIST,
      activeMcpServerNames: new Set([MCP_SERVER_BASE_NAME]),
    })

    expect(serverConfigMap).toBeUndefined()
  })

  it('returns undefined when duplicate tool names are detected', async () => {
    const duplicateTools = [
      makeTool('dup_tool', 'a'),
      makeTool('dup_tool', 'b'),
    ]
    const duplicateRegistry = {
      getAllToolDescriptors: () => duplicateTools,
      getToolDescriptorsByAllowlist: () => duplicateTools,
    }

    const manager = new CodexNativeBridgeManager(duplicateRegistry as never)
    managers.push(manager)
    ;(manager as unknown as { ensureHttpServer: () => Promise<void> }).ensureHttpServer = async () => {
      ;(manager as unknown as { port: number }).port = 39008
    }
    ;(manager as unknown as { ensureBridgeScript: () => Promise<string> }).ensureBridgeScript = async () =>
      '/tmp/opencow-codex-native-bridge.mjs'

    const serverConfigMap = await manager.registerSession({
      session: { sessionId: 'session-bridge-dup-tools', projectId: null, originSource: 'agent' },
      relay: new ToolProgressRelay(),
      nativeToolAllowlist: CUSTOM_ALLOWLIST,
    })

    expect(serverConfigMap).toBeUndefined()
  })

  it('fails open when bridge setup throws', async () => {
    const manager = new CodexNativeBridgeManager(makeRegistryStub() as never)
    managers.push(manager)
    ;(manager as unknown as { ensureHttpServer: () => Promise<void> }).ensureHttpServer = async () => {
      throw new Error('listen EPERM')
    }

    const serverConfigMap = await manager.registerSession({
      session: { sessionId: 'session-bridge-fail-open', projectId: null, originSource: 'agent' },
      relay: new ToolProgressRelay(),
      nativeToolAllowlist: PROJECT_ALLOWLIST,
    })

    expect(serverConfigMap).toBeUndefined()
  })

  it('returns 403 for list-tools with invalid token', async () => {
    const manager = new CodexNativeBridgeManager(makeRegistryStub() as never)
    managers.push(manager)
    ;(manager as unknown as { ensureHttpServer: () => Promise<void> }).ensureHttpServer = async () => {
      ;(manager as unknown as { port: number }).port = 39003
    }
    ;(manager as unknown as { ensureBridgeScript: () => Promise<string> }).ensureBridgeScript = async () =>
      '/tmp/opencow-codex-native-bridge.mjs'

    const sessionId = 'session-bridge-auth-1'
    const serverConfigMap = await manager.registerSession({
      session: { sessionId, projectId: null, originSource: 'agent' },
      relay: new ToolProgressRelay(),
      nativeToolAllowlist: PROJECT_ALLOWLIST,
    })
    expect(serverConfigMap).toBeTruthy()

    const req = makeGetRequest(`/codex-native/list-tools?sessionId=${encodeURIComponent(sessionId)}`, 'invalid-token')
    const res = makeResponseRecorder()

    await (manager as unknown as {
      handleRequest: (req: IncomingMessage, res: ServerResponse) => Promise<void>
    }).handleRequest(req, res)

    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body)).toEqual({
      error: { code: 'forbidden', message: 'Forbidden' },
    })
  })

  it('returns 403 when token from one session is used to access another', async () => {
    const manager = new CodexNativeBridgeManager(makeRegistryStub() as never)
    managers.push(manager)
    ;(manager as unknown as { ensureHttpServer: () => Promise<void> }).ensureHttpServer = async () => {
      ;(manager as unknown as { port: number }).port = 39004
    }
    ;(manager as unknown as { ensureBridgeScript: () => Promise<string> }).ensureBridgeScript = async () =>
      '/tmp/opencow-codex-native-bridge.mjs'

    const configA = await manager.registerSession({
      session: { sessionId: 'session-bridge-auth-a', projectId: null, originSource: 'agent' },
      relay: new ToolProgressRelay(),
      nativeToolAllowlist: PROJECT_ALLOWLIST,
    })
    const configB = await manager.registerSession({
      session: { sessionId: 'session-bridge-auth-b', projectId: null, originSource: 'agent' },
      relay: new ToolProgressRelay(),
      nativeToolAllowlist: PROJECT_ALLOWLIST,
    })

    const envA = ((configA as Record<string, Record<string, unknown>>)[MCP_SERVER_BASE_NAME]
      .env as Record<string, string>)
    expect(configB).toBeTruthy()

    const req = makeGetRequest('/codex-native/list-tools?sessionId=session-bridge-auth-b', envA.OPENCOW_CODEX_BRIDGE_TOKEN)
    const res = makeResponseRecorder()

    await (manager as unknown as {
      handleRequest: (req: IncomingMessage, res: ServerResponse) => Promise<void>
    }).handleRequest(req, res)

    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body)).toEqual({
      error: { code: 'forbidden', message: 'Forbidden' },
    })
  })

  it('returns 403 for call-tool with invalid token', async () => {
    const manager = new CodexNativeBridgeManager(makeRegistryStub() as never)
    managers.push(manager)
    ;(manager as unknown as { ensureHttpServer: () => Promise<void> }).ensureHttpServer = async () => {
      ;(manager as unknown as { port: number }).port = 39005
    }
    ;(manager as unknown as { ensureBridgeScript: () => Promise<string> }).ensureBridgeScript = async () =>
      '/tmp/opencow-codex-native-bridge.mjs'

    const sessionId = 'session-bridge-auth-post'
    const serverConfigMap = await manager.registerSession({
      session: { sessionId, projectId: null, originSource: 'agent' },
      relay: new ToolProgressRelay(),
      nativeToolAllowlist: PROJECT_ALLOWLIST,
    })
    expect(serverConfigMap).toBeTruthy()

    const req = makePostRequest('/codex-native/call-tool', 'invalid-token', [
      JSON.stringify({
        sessionId,
        name: 'list_projects',
        args: { q: 'docs' },
      }),
    ])
    const res = makeResponseRecorder()

    await (manager as unknown as {
      handleRequest: (req: IncomingMessage, res: ServerResponse) => Promise<void>
    }).handleRequest(req, res)

    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body)).toEqual({
      error: { code: 'forbidden', message: 'Forbidden' },
    })
  })

  it('returns 400 for invalid JSON call-tool payload', async () => {
    const manager = new CodexNativeBridgeManager(makeRegistryStub() as never)
    managers.push(manager)
    ;(manager as unknown as { ensureHttpServer: () => Promise<void> }).ensureHttpServer = async () => {
      ;(manager as unknown as { port: number }).port = 39006
    }
    ;(manager as unknown as { ensureBridgeScript: () => Promise<string> }).ensureBridgeScript = async () =>
      '/tmp/opencow-codex-native-bridge.mjs'

    const sessionId = 'session-bridge-invalid-json'
    const serverConfigMap = await manager.registerSession({
      session: { sessionId, projectId: null, originSource: 'agent' },
      relay: new ToolProgressRelay(),
      nativeToolAllowlist: PROJECT_ALLOWLIST,
    })
    const env = ((serverConfigMap as Record<string, Record<string, unknown>>)[MCP_SERVER_BASE_NAME]
      .env as Record<string, string>)

    const req = makePostRequest('/codex-native/call-tool', env.OPENCOW_CODEX_BRIDGE_TOKEN, ['{"bad":'])
    const res = makeResponseRecorder()

    await (manager as unknown as {
      handleRequest: (req: IncomingMessage, res: ServerResponse) => Promise<void>
    }).handleRequest(req, res)

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toEqual({
      error: {
        code: 'invalid_json',
        message: expect.any(String),
      },
    })
  })

  it('returns 413 when call-tool payload exceeds byte limit', async () => {
    const manager = new CodexNativeBridgeManager(makeRegistryStub() as never)
    managers.push(manager)
    ;(manager as unknown as { ensureHttpServer: () => Promise<void> }).ensureHttpServer = async () => {
      ;(manager as unknown as { port: number }).port = 39007
    }
    ;(manager as unknown as { ensureBridgeScript: () => Promise<string> }).ensureBridgeScript = async () =>
      '/tmp/opencow-codex-native-bridge.mjs'

    const sessionId = 'session-bridge-large-body'
    const serverConfigMap = await manager.registerSession({
      session: { sessionId, projectId: null, originSource: 'agent' },
      relay: new ToolProgressRelay(),
      nativeToolAllowlist: PROJECT_ALLOWLIST,
    })
    const env = ((serverConfigMap as Record<string, Record<string, unknown>>)[MCP_SERVER_BASE_NAME]
      .env as Record<string, string>)

    const oversizedBody = JSON.stringify({
      sessionId,
      name: 'list_projects',
      args: { payload: 'x'.repeat(600_000) },
    })
    const req = makePostRequest('/codex-native/call-tool', env.OPENCOW_CODEX_BRIDGE_TOKEN, [oversizedBody])
    const res = makeResponseRecorder()

    await (manager as unknown as {
      handleRequest: (req: IncomingMessage, res: ServerResponse) => Promise<void>
    }).handleRequest(req, res)

    expect(res.statusCode).toBe(413)
    expect(JSON.parse(res.body)).toEqual({
      error: {
        code: 'payload_too_large',
        message: expect.any(String),
      },
    })
  })

  it('returns 400 when call-tool arguments fail schema type validation', async () => {
    // Use a tool with a required typed field so we can trigger a genuine type error
    const typedTools = [
      makeTool('typed_tool', 'A tool with required schema', { query: z.string() }),
    ]
    const typedRegistry = {
      getAllToolDescriptors: () => typedTools,
      getToolDescriptorsByAllowlist: () => typedTools,
    }

    const manager = new CodexNativeBridgeManager(typedRegistry as never)
    managers.push(manager)
    ;(manager as unknown as { ensureHttpServer: () => Promise<void> }).ensureHttpServer = async () => {
      ;(manager as unknown as { port: number }).port = 39010
    }
    ;(manager as unknown as { ensureBridgeScript: () => Promise<string> }).ensureBridgeScript = async () =>
      '/tmp/opencow-codex-native-bridge.mjs'

    const sessionId = 'session-bridge-invalid-args'
    const serverConfigMap = await manager.registerSession({
      session: { sessionId, projectId: null, originSource: 'agent' },
      relay: new ToolProgressRelay(),
      nativeToolAllowlist: CUSTOM_ALLOWLIST,
    })
    const env = ((serverConfigMap as Record<string, Record<string, unknown>>)[MCP_SERVER_BASE_NAME]
      .env as Record<string, string>)

    // Send wrong type: query should be string but we send number
    const req = makePostRequest('/codex-native/call-tool', env.OPENCOW_CODEX_BRIDGE_TOKEN, [
      JSON.stringify({
        sessionId,
        name: 'typed_tool',
        args: { query: 12345 },
      }),
    ])
    const res = makeResponseRecorder()

    await (manager as unknown as {
      handleRequest: (req: IncomingMessage, res: ServerResponse) => Promise<void>
    }).handleRequest(req, res)

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toEqual({
      error: {
        code: 'invalid_tool_arguments',
        message: expect.stringContaining('Invalid arguments for tool "typed_tool"'),
      },
    })
  })

  it('strips unknown properties from call-tool arguments instead of rejecting them', async () => {
    let receivedArgs: Record<string, unknown> | null = null
    const echoTools = [
      {
        name: 'echo_args',
        description: 'Echo received args',
        inputSchema: { name: z.string() },
        execute: async (input: { args: Record<string, unknown> }) => {
          receivedArgs = input.args
          return { content: [{ type: 'text' as const, text: 'ok' }] }
        },
      },
    ]
    const echoRegistry = {
      getAllToolDescriptors: () => echoTools,
      getToolDescriptorsByAllowlist: () => echoTools,
    }

    const manager = new CodexNativeBridgeManager(echoRegistry as never)
    managers.push(manager)
    ;(manager as unknown as { ensureHttpServer: () => Promise<void> }).ensureHttpServer = async () => {
      ;(manager as unknown as { port: number }).port = 39017
    }
    ;(manager as unknown as { ensureBridgeScript: () => Promise<string> }).ensureBridgeScript = async () =>
      '/tmp/opencow-codex-native-bridge.mjs'

    const sessionId = 'session-bridge-strip-args'
    const serverConfigMap = await manager.registerSession({
      session: { sessionId, projectId: null, originSource: 'agent' },
      relay: new ToolProgressRelay(),
      nativeToolAllowlist: CUSTOM_ALLOWLIST,
    })
    const env = ((serverConfigMap as Record<string, Record<string, unknown>>)[MCP_SERVER_BASE_NAME]
      .env as Record<string, string>)

    // Send valid 'name' plus extra unknown properties
    const req = makePostRequest('/codex-native/call-tool', env.OPENCOW_CODEX_BRIDGE_TOKEN, [
      JSON.stringify({
        sessionId,
        name: 'echo_args',
        args: { name: 'Alice', _meta: { source: 'sdk' }, plan: 'something' },
      }),
    ])
    const res = makeResponseRecorder()

    await (manager as unknown as {
      handleRequest: (req: IncomingMessage, res: ServerResponse) => Promise<void>
    }).handleRequest(req, res)

    expect(res.statusCode).toBe(200)
    // Unknown keys (_meta, plan) should be stripped; only declared keys retained
    expect(receivedArgs).toEqual({ name: 'Alice' })
  })

  it('passes toolUseId/invocationId metadata into native tool execution context', async () => {
    let receivedInput: Record<string, unknown> | null = null
    const metadataTools = [
      {
        name: 'echo_tool',
        description: 'Echo',
        inputSchema: {},
        execute: async (input: Record<string, unknown>) => {
          receivedInput = input
          return { content: [{ type: 'text', text: 'ok' }] }
        },
      },
    ]
    const metadataRegistry = {
      getAllToolDescriptors: () => metadataTools,
      getToolDescriptorsByAllowlist: () => metadataTools,
    }

    const manager = new CodexNativeBridgeManager(metadataRegistry as never)
    managers.push(manager)
    ;(manager as unknown as { ensureHttpServer: () => Promise<void> }).ensureHttpServer = async () => {
      ;(manager as unknown as { port: number }).port = 39015
    }
    ;(manager as unknown as { ensureBridgeScript: () => Promise<string> }).ensureBridgeScript = async () =>
      '/tmp/opencow-codex-native-bridge.mjs'

    const sessionId = 'session-bridge-metadata'
    const serverConfigMap = await manager.registerSession({
      session: { sessionId, projectId: null, originSource: 'agent' },
      relay: new ToolProgressRelay(),
      nativeToolAllowlist: CUSTOM_ALLOWLIST,
    })
    const env = ((serverConfigMap as Record<string, Record<string, unknown>>)[MCP_SERVER_BASE_NAME]
      .env as Record<string, string>)

    const req = makePostRequest('/codex-native/call-tool', env.OPENCOW_CODEX_BRIDGE_TOKEN, [
      JSON.stringify({
        sessionId,
        name: 'echo_tool',
        args: {},
        toolUseId: 'tool-use-123',
        invocationId: 'invocation-123',
      }),
    ])
    const res = makeResponseRecorder()

    await (manager as unknown as {
      handleRequest: (req: IncomingMessage, res: ServerResponse) => Promise<void>
    }).handleRequest(req, res)

    expect(res.statusCode).toBe(200)
    expect(receivedInput).toMatchObject({
      args: {},
      context: {
        engine: 'codex',
        toolUseId: 'tool-use-123',
        invocationId: 'invocation-123',
      },
    })
  })

  it('falls back invocationId to toolUseId when invocationId is absent', async () => {
    let receivedInput: Record<string, unknown> | null = null
    const metadataTools = [
      {
        name: 'echo_tool',
        description: 'Echo',
        inputSchema: {},
        execute: async (input: Record<string, unknown>) => {
          receivedInput = input
          return { content: [{ type: 'text', text: 'ok' }] }
        },
      },
    ]
    const metadataRegistry = {
      getAllToolDescriptors: () => metadataTools,
      getToolDescriptorsByAllowlist: () => metadataTools,
    }

    const manager = new CodexNativeBridgeManager(metadataRegistry as never)
    managers.push(manager)
    ;(manager as unknown as { ensureHttpServer: () => Promise<void> }).ensureHttpServer = async () => {
      ;(manager as unknown as { port: number }).port = 39016
    }
    ;(manager as unknown as { ensureBridgeScript: () => Promise<string> }).ensureBridgeScript = async () =>
      '/tmp/opencow-codex-native-bridge.mjs'

    const sessionId = 'session-bridge-metadata-fallback'
    const serverConfigMap = await manager.registerSession({
      session: { sessionId, projectId: null, originSource: 'agent' },
      relay: new ToolProgressRelay(),
      nativeToolAllowlist: CUSTOM_ALLOWLIST,
    })
    const env = ((serverConfigMap as Record<string, Record<string, unknown>>)[MCP_SERVER_BASE_NAME]
      .env as Record<string, string>)

    const req = makePostRequest('/codex-native/call-tool', env.OPENCOW_CODEX_BRIDGE_TOKEN, [
      JSON.stringify({
        sessionId,
        name: 'echo_tool',
        args: {},
        toolUseId: 'tool-use-456',
      }),
    ])
    const res = makeResponseRecorder()

    await (manager as unknown as {
      handleRequest: (req: IncomingMessage, res: ServerResponse) => Promise<void>
    }).handleRequest(req, res)

    expect(res.statusCode).toBe(200)
    expect(receivedInput).toMatchObject({
      context: {
        engine: 'codex',
        toolUseId: 'tool-use-456',
        invocationId: 'tool-use-456',
      },
    })
  })

  it('returns 504 and aborts tool execution on timeout', async () => {
    vi.useFakeTimers()
    try {
      let abortedBySignal = false
      const slowTool = {
        name: 'slow_tool',
        description: 'Never resolves',
        inputSchema: {},
        execute: async (input: { context: { signal?: AbortSignal } }) =>
          new Promise((_, reject) => {
            input.context.signal?.addEventListener(
              'abort',
              () => {
                abortedBySignal = true
                reject(new Error('aborted'))
              },
              { once: true },
            )
          }),
      }
      const timeoutRegistry = {
        getAllToolDescriptors: () => [slowTool],
        getToolDescriptorsByAllowlist: () => [slowTool],
      }

      const manager = new CodexNativeBridgeManager(timeoutRegistry as never)
      managers.push(manager)
      ;(manager as unknown as { ensureHttpServer: () => Promise<void> }).ensureHttpServer = async () => {
        ;(manager as unknown as { port: number }).port = 39009
      }
      ;(manager as unknown as { ensureBridgeScript: () => Promise<string> }).ensureBridgeScript = async () =>
        '/tmp/opencow-codex-native-bridge.mjs'

      const sessionId = 'session-bridge-timeout'
      const serverConfigMap = await manager.registerSession({
        session: { sessionId, projectId: null, originSource: 'agent' },
        relay: new ToolProgressRelay(),
        nativeToolAllowlist: CUSTOM_ALLOWLIST,
      })
      const env = ((serverConfigMap as Record<string, Record<string, unknown>>)[MCP_SERVER_BASE_NAME]
        .env as Record<string, string>)

      const req = makePostRequest('/codex-native/call-tool', env.OPENCOW_CODEX_BRIDGE_TOKEN, [
        JSON.stringify({
          sessionId,
          name: 'slow_tool',
          args: {},
        }),
      ])
      const res = makeResponseRecorder()

      const callPromise = (manager as unknown as {
        handleRequest: (req: IncomingMessage, res: ServerResponse) => Promise<void>
      }).handleRequest(req, res)

      await vi.advanceTimersByTimeAsync(600_000)
      await callPromise

      expect(abortedBySignal).toBe(true)
      expect(res.statusCode).toBe(504)
      expect(JSON.parse(res.body)).toEqual({
        error: {
          code: 'tool_timeout',
          message: expect.any(String),
        },
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
