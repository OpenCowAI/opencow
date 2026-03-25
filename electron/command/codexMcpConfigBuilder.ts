// SPDX-License-Identifier: Apache-2.0

export type CodexConfigObject = Record<string, unknown>

export interface CodexMcpServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  [key: string]: unknown
}

export type CodexMcpServerMap = Record<string, CodexMcpServerConfig>

interface MergeCodexMcpServersInput {
  baseConfig?: unknown
  overlays?: Array<CodexMcpServerMap | undefined>
}

export interface MergeCodexMcpServersResult {
  config?: CodexConfigObject
  mcpServers: CodexMcpServerMap
  activeServerNames: ReadonlySet<string>
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function toCodexConfigObject(value: unknown): CodexConfigObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return { ...(value as Record<string, unknown>) }
}

function normalizeMcpServers(value: unknown): CodexMcpServerMap {
  const raw = asRecord(value)
  const out: CodexMcpServerMap = {}
  for (const [name, config] of Object.entries(raw)) {
    if (!name) continue
    if (!config || typeof config !== 'object' || Array.isArray(config)) continue
    out[name] = config as CodexMcpServerConfig
  }
  return out
}

export function mergeCodexMcpServers(input: MergeCodexMcpServersInput): MergeCodexMcpServersResult {
  const base = toCodexConfigObject(input.baseConfig)
  let mergedMcpServers = normalizeMcpServers(base?.mcp_servers)

  for (const overlay of input.overlays ?? []) {
    if (!overlay) continue
    const normalized = normalizeMcpServers(overlay)
    if (Object.keys(normalized).length === 0) continue
    mergedMcpServers = { ...mergedMcpServers, ...normalized }
  }

  const hasBase = !!base && Object.keys(base).length > 0
  const hasMcp = Object.keys(mergedMcpServers).length > 0
  const config = (hasBase || hasMcp)
    ? ({
      ...(base ?? {}),
      mcp_servers: mergedMcpServers,
    } as CodexConfigObject)
    : undefined

  return {
    config,
    mcpServers: mergedMcpServers,
    activeServerNames: new Set(Object.keys(mergedMcpServers)),
  }
}
