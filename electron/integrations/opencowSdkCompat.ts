// SPDX-License-Identifier: Apache-2.0

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type {
  CallToolResult,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod/v4'

export type AnyZodRawShape = z.ZodRawShape
export type InferShape<Shape extends AnyZodRawShape = AnyZodRawShape> = z.infer<z.ZodObject<Shape>>

export type SdkMcpToolDefinition<Schema extends AnyZodRawShape = AnyZodRawShape> = {
  name: string
  description: string
  inputSchema: Schema
  handler: (args: InferShape<Schema>, extra: unknown) => Promise<CallToolResult>
  annotations?: ToolAnnotations
  _meta?: Record<string, unknown>
}

export type McpStdioServerConfig = {
  type?: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
}

export type McpSSEServerConfig = {
  type: 'sse'
  url: string
  headers?: Record<string, string>
}

export type McpHttpServerConfig = {
  type: 'http'
  url: string
  headers?: Record<string, string>
}

export type McpSdkServerConfig = {
  type: 'sdk'
  name: string
}

export type McpSdkServerConfigWithInstance = McpSdkServerConfig & {
  instance?: McpServer
  server?: McpServer
}

export type McpServerConfig =
  | McpStdioServerConfig
  | McpSSEServerConfig
  | McpHttpServerConfig
  | McpSdkServerConfigWithInstance

export function tool<Schema extends AnyZodRawShape>(
  name: string,
  description: string,
  inputSchema: Schema,
  handler: (args: InferShape<Schema>, extra: unknown) => Promise<CallToolResult>,
  extras?: {
    annotations?: ToolAnnotations
    searchHint?: string
    alwaysLoad?: boolean
  },
): SdkMcpToolDefinition<Schema> {
  return {
    name,
    description,
    inputSchema,
    handler,
    annotations: extras?.annotations,
    _meta: {
      ...(extras?.searchHint ? { 'anthropic/searchHint': extras.searchHint } : {}),
      ...(extras?.alwaysLoad ? { 'anthropic/alwaysLoad': true } : {}),
    },
  }
}

type CreateSdkMcpServerOptions = {
  name: string
  version?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools?: Array<SdkMcpToolDefinition<any>>
}

export function createSdkMcpServer(
  options: CreateSdkMcpServerOptions,
): McpSdkServerConfigWithInstance {
  const server = new McpServer({
    name: options.name,
    version: options.version ?? '1.0.0',
  })

  for (const sdkTool of options.tools ?? []) {
    server.registerTool(
      sdkTool.name,
      {
        description: sdkTool.description,
        inputSchema: sdkTool.inputSchema,
        annotations: sdkTool.annotations,
        _meta: sdkTool._meta,
      },
      async (args: unknown, extra: unknown) =>
        sdkTool.handler(args as InferShape<typeof sdkTool.inputSchema>, extra),
    )
  }

  return {
    type: 'sdk',
    name: options.name,
    instance: server,
    server,
  }
}
