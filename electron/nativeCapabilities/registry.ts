// SPDX-License-Identifier: Apache-2.0

/**
 * NativeCapabilityRegistry — central registration point for all built-in native capabilities.
 *
 * Unlike the Capabilities scanner system (which discovers items from the filesystem),
 * native capabilities are registered programmatically during app initialisation.
 * This is intentional: native capabilities are compiled-in features, not user-contributed.
 *
 * The registry also owns MCP server creation (previously in MCPBridge).
 * Each SDK session requires a **fresh** MCP server instance because the SDK's
 * internal transport is single-use — reusing an instance across sessions
 * causes "Already connected to a transport" errors.
 */

import { createSdkMcpServer } from '../integrations/opencowSdkCompat'
import type { McpServerConfig } from '../integrations/opencowSdkCompat'
import type {
  NativeCapability,
  NativeCapabilityCategory,
  NativeCapabilityMeta,
  NativeCapabilityToolContext,
  NativeToolDescriptor,
} from './types'
import { isNativeCapabilityCategory } from './types'
import { createLogger } from '../platform/logger'
import { MCP_SERVER_BASE_NAME } from '@shared/appIdentity'
import type { StartSessionNativeToolAllowItem } from '@shared/types'
import { toClaudeToolDefinitions } from './claudeToolAdapter'

const log = createLogger('NativeCapabilityRegistry')

/** The key used to register the OpenCow MCP server in SDK options.mcpServers */
const MCP_SERVER_NAME = MCP_SERVER_BASE_NAME
const MCP_SERVER_VERSION = '1.0.0'

export class NativeCapabilityRegistry {
  private readonly capabilities = new Map<NativeCapabilityCategory, NativeCapability>()

  /**
   * Register a built-in native capability.
   * Throws if a native capability with the same category is already registered.
   */
  register(capability: NativeCapability): void {
    const { category, name } = capability.meta
    if (this.capabilities.has(category)) {
      throw new Error(`NativeCapability already registered for category "${category}"`)
    }
    this.capabilities.set(category, capability)
    log.info(`Registered native capability: ${name} (${category})`)
  }

  /**
   * Collect MCP tools using structured native-tool allowlist.
   *
   * Rules:
   * - entry `{ capability }`      -> allow all tools from that capability
   * - entry `{ capability, tool }` -> allow only that specific tool
   * - duplicate entries are deduplicated
   */
  getToolDescriptorsByAllowlist(
    allowlist: StartSessionNativeToolAllowItem[],
    context: NativeCapabilityToolContext,
  ): NativeToolDescriptor[] {
    if (allowlist.length === 0) return []

    const toolFilterByCapability = new Map<string, Set<string> | null>()
    for (const item of allowlist) {
      const capability = item.capability.trim()
      if (!capability) continue
      const tool = item.tool?.trim()
      const existing = toolFilterByCapability.get(capability)
      if (existing === null) continue
      if (!tool) {
        toolFilterByCapability.set(capability, null)
        continue
      }
      if (!existing) {
        toolFilterByCapability.set(capability, new Set([tool]))
        continue
      }
      existing.add(tool)
    }

    const tools: NativeToolDescriptor[] = []
    for (const [capabilityName, toolFilter] of toolFilterByCapability.entries()) {
      if (!isNativeCapabilityCategory(capabilityName)) {
        log.warn(`Native capability allowlist skipped unknown category "${capabilityName}"`)
        continue
      }

      const capability = this.capabilities.get(capabilityName)
      if (!capability) {
        log.warn(`Native capability allowlist skipped unknown category "${capabilityName}"`)
        continue
      }
      const descriptors = capability.getToolDescriptors(context)
      if (toolFilter === null) {
        tools.push(...descriptors)
        continue
      }
      tools.push(...descriptors.filter((descriptor) => toolFilter.has(descriptor.name)))
    }

    assertNoDuplicateToolNames(tools)
    log.info(
      `Collected ${tools.length} MCP tools via allowlist for session ${context.session.sessionId}`,
    )
    return tools
  }

  /**
   * Create MCP server config using structured native-tool allowlist.
   *
   * Creates a fresh server instance per call (MCP transport is single-use).
   */
  createMcpServerConfigForAllowlist(
    allowlist: StartSessionNativeToolAllowItem[],
    context: NativeCapabilityToolContext,
  ): { mcpServers: Record<string, McpServerConfig> } | undefined {
    const descriptors = this.getToolDescriptorsByAllowlist(allowlist, context)
    if (descriptors.length === 0) return undefined
    const tools = toClaudeToolDefinitions(descriptors)

    const serverConfig = createSdkMcpServer({
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
      tools,
    })

    log.info(
      `Created allowlist-filtered MCP server for session ${context.session.sessionId}: ${tools.length} tools`,
    )

    return {
      mcpServers: {
        [MCP_SERVER_NAME]: serverConfig,
      },
    }
  }

  /** List metadata for all registered native capabilities. */
  list(): NativeCapabilityMeta[] {
    return [...this.capabilities.values()].map((c) => c.meta)
  }

  /** Get a native capability by category. */
  get(category: NativeCapabilityCategory): NativeCapability | undefined {
    return this.capabilities.get(category)
  }

  /**
   * Initialise all native capabilities that have a start() method.
   *
   * NativeCapabilities are independent — they are started concurrently via
   * Promise.allSettled so that a failure in one does not block the others.
   * Failures are logged but never propagated.
   */
  async startAll(): Promise<void> {
    const startable = [...this.capabilities.values()].filter((c) => c.start)
    if (startable.length === 0) return

    const results = await Promise.allSettled(
      startable.map(async (capability) => {
        await capability.start!()
        log.info(`Started native capability: ${capability.meta.name}`)
      }),
    )

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        log.error(`Failed to start native capability: ${startable[i].meta.name}`, (results[i] as PromiseRejectedResult).reason)
      }
    }
  }

  /** Dispose all native capabilities (shutdown cleanup). */
  async disposeAll(): Promise<void> {
    for (const capability of this.capabilities.values()) {
      if (capability.dispose) {
        try {
          await capability.dispose()
          log.info(`Disposed native capability: ${capability.meta.name}`)
        } catch (err) {
          log.error(`Error disposing native capability ${capability.meta.name}`, err)
        }
      }
    }
    this.capabilities.clear()
  }
}

function assertNoDuplicateToolNames(tools: NativeToolDescriptor[]): void {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      duplicates.add(tool.name)
      continue
    }
    seen.add(tool.name)
  }
  if (duplicates.size > 0) {
    const sorted = [...duplicates].sort()
    throw new Error(`Duplicate native tool names are not allowed: ${sorted.join(', ')}`)
  }
}
