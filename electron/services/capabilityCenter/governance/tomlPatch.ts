// SPDX-License-Identifier: Apache-2.0

import * as TOML from '@iarna/toml'
import { isPlainObject } from '@shared/typeGuards'

const MCP_SERVERS_KEY = 'mcp_servers'
const OPENCOW_SECTION_KEY = 'opencow'
const OPENCOW_MANAGED_MCP_KEY = 'managed_mcp_servers'

type TomlObject = Record<string, unknown>

function markerFor(name: string): string {
  return `opencow:${name}`
}

export function parseTomlConfig(content: string): TomlObject {
  const parsed = TOML.parse(content)
  if (!isPlainObject(parsed)) {
    throw new Error('Invalid TOML document: expected an object root')
  }
  return parsed as TomlObject
}

export function stringifyTomlConfig(config: TomlObject): string {
  const output = TOML.stringify(config)
  return output.endsWith('\n') ? output : `${output}\n`
}

export function extractMcpServersFromToml(content: string): Record<string, TomlObject> {
  const parsed = parseTomlConfig(content)
  const mcpServers = parsed[MCP_SERVERS_KEY]
  if (!isPlainObject(mcpServers)) return {}

  const result: Record<string, TomlObject> = {}
  for (const [name, value] of Object.entries(mcpServers)) {
    if (!isPlainObject(value)) continue
    result[name] = value as TomlObject
  }
  return result
}

export function upsertManagedCodexMcpServer(params: {
  existingContent?: string | null
  name: string
  serverConfig: TomlObject
}): string {
  const root = params.existingContent
    ? parseTomlConfig(params.existingContent)
    : {}

  const mcpServers = ensureObject(root, MCP_SERVERS_KEY)
  const markers = ensureManagedMarkers(root)

  const existing = mcpServers[params.name]
  const marker = markers[params.name]
  if (existing != null && marker !== markerFor(params.name)) {
    throw new Error(`Codex MCP server "${params.name}" already exists and is not managed by OpenCow`)
  }

  mcpServers[params.name] = removeUndefined(params.serverConfig)
  markers[params.name] = markerFor(params.name)
  return stringifyTomlConfig(root)
}

export function removeManagedCodexMcpServer(params: {
  existingContent?: string | null
  name: string
}): {
  content: string
  removed: boolean
} {
  const fallback = params.existingContent ?? ''
  if (!params.existingContent) {
    return { content: fallback, removed: false }
  }

  const root = parseTomlConfig(params.existingContent)
  const mcpServers = root[MCP_SERVERS_KEY]
  const markers = getManagedMarkers(root)
  if (!isPlainObject(mcpServers) || !isPlainObject(markers)) {
    return { content: params.existingContent, removed: false }
  }

  const marker = markers[params.name]
  if (marker !== markerFor(params.name)) {
    return { content: params.existingContent, removed: false }
  }

  delete (mcpServers as TomlObject)[params.name]
  delete (markers as TomlObject)[params.name]
  pruneEmptyNestedSections(root)

  return {
    content: stringifyTomlConfig(root),
    removed: true,
  }
}

function ensureObject(root: TomlObject, key: string): TomlObject {
  const value = root[key]
  if (isPlainObject(value)) return value as TomlObject
  const created: TomlObject = {}
  root[key] = created
  return created
}

function ensureManagedMarkers(root: TomlObject): TomlObject {
  const opencow = ensureObject(root, OPENCOW_SECTION_KEY)
  return ensureObject(opencow, OPENCOW_MANAGED_MCP_KEY)
}

function getManagedMarkers(root: TomlObject): TomlObject | null {
  const opencow = root[OPENCOW_SECTION_KEY]
  if (!isPlainObject(opencow)) return null
  const markers = opencow[OPENCOW_MANAGED_MCP_KEY]
  return isPlainObject(markers) ? (markers as TomlObject) : null
}

function removeUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => removeUndefined(item))
  }
  if (!isPlainObject(value)) {
    return value
  }
  const out: TomlObject = {}
  for (const [key, val] of Object.entries(value)) {
    if (val === undefined) continue
    out[key] = removeUndefined(val)
  }
  return out
}

function pruneEmptyNestedSections(root: TomlObject): void {
  const mcpServers = root[MCP_SERVERS_KEY]
  if (isPlainObject(mcpServers) && Object.keys(mcpServers).length === 0) {
    delete root[MCP_SERVERS_KEY]
  }

  const opencow = root[OPENCOW_SECTION_KEY]
  if (!isPlainObject(opencow)) return

  const markers = opencow[OPENCOW_MANAGED_MCP_KEY]
  if (isPlainObject(markers) && Object.keys(markers).length === 0) {
    delete opencow[OPENCOW_MANAGED_MCP_KEY]
  }

  if (Object.keys(opencow).length === 0) {
    delete root[OPENCOW_SECTION_KEY]
  }
}
