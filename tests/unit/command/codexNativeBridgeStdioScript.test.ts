// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { buildCodexNativeBridgeStdioScript } from '../../../electron/command/codexNativeBridgeStdioScript'

describe('buildCodexNativeBridgeStdioScript', () => {
  const modules = {
    mcpServerModulePath: '/tmp/fake/mcp.js',
    stdioServerTransportModulePath: '/tmp/fake/stdio.js',
    zodModulePath: '/tmp/fake/zod.js',
  }

  it('contains required bridge environment variable checks and endpoints', () => {
    const script = buildCodexNativeBridgeStdioScript(modules)

    expect(script).toContain('OPENCOW_CODEX_BRIDGE_URL')
    expect(script).toContain('OPENCOW_CODEX_BRIDGE_TOKEN')
    expect(script).toContain('OPENCOW_CODEX_BRIDGE_SESSION_ID')
    expect(script).toContain('/codex-native/list-tools?sessionId=')
    expect(script).toContain('/codex-native/call-tool')
  })

  it('extracts invocation metadata from MCP callback extra and forwards to bridge', () => {
    const script = buildCodexNativeBridgeStdioScript(modules)

    expect(script).toContain('async (args, extra) =>')
    expect(script).toContain('extractToolUseId')
    expect(script).toContain('extractInvocationId')
    expect(script).toContain('toolUseId')
    expect(script).toContain('invocationId')
  })

  it('supports structured bridge error payload parsing', () => {
    const script = buildCodexNativeBridgeStdioScript(modules)

    expect(script).toContain('typeof payload.error.code === \'string\'')
    expect(script).toContain('typeof payload.error.message === \'string\'')
    expect(script).toContain('Bridge error:')
  })

  it('builds zod input schema from list-tools JSON schema payload', () => {
    const script = buildCodexNativeBridgeStdioScript(modules)

    expect(script).toContain('inferSchemaFromJsonSchema')
    expect(script).toContain('item.inputSchema')
    expect(script).toContain('inputSchema },')
    expect(script).toContain('node.oneOf')
    expect(script).toContain('node.anyOf')
    expect(script).toContain('node.allOf')
    expect(script).toContain('node.minLength')
    expect(script).toContain('node.additionalProperties')
  })

  it('pins dependencies to absolute module paths (no temp-dir bare imports)', () => {
    const script = buildCodexNativeBridgeStdioScript(modules)

    expect(script).toContain(`require("${modules.mcpServerModulePath}")`)
    expect(script).toContain(`require("${modules.stdioServerTransportModulePath}")`)
    expect(script).toContain(`require("${modules.zodModulePath}")`)
    expect(script).not.toContain(`from '@modelcontextprotocol/sdk/server/mcp.js'`)
    expect(script).not.toContain(`from 'zod/v4'`)
  })

  it('handles additionalProperties correctly with explicit false, true, and empty object', () => {
    const script = buildCodexNativeBridgeStdioScript(modules)

    // Must check for explicit false before truthy object check
    expect(script).toContain('additionalProperties === false')
    // Must check for explicit true
    expect(script).toContain('additionalProperties === true')
    // Must guard against empty schema object {} (JSON Schema "allow any")
    expect(script).toContain('Object.keys(node.additionalProperties)')
    // Must use passthrough for empty object case
    expect(script).toContain('.passthrough()')
    // Must use strict for explicit false
    expect(script).toContain('.strict()')
    // Must use catchall for non-empty schema objects
    expect(script).toContain('.catchall(')
  })
})
