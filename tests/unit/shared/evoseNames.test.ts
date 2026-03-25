// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import {
  sanitizeEvoseAppName,
  isEvoseToolName,
  isEvoseGatewayToolName,
  extractEvoseLocalName,
  resolveEvoseAppInfo,
  EVOSE_RUN_AGENT_LOCAL_NAME,
  EVOSE_RUN_WORKFLOW_LOCAL_NAME,
  EVOSE_LIST_APPS_LOCAL_NAME,
} from '../../../src/shared/evoseNames'

describe('sanitizeEvoseAppName', () => {
  it('lowercases and replaces spaces with underscores', () => {
    expect(sanitizeEvoseAppName('Customer Support')).toBe('customer_support')
  })
  it('removes non-alphanumeric chars', () => {
    expect(sanitizeEvoseAppName('AI-Bot v2!')).toBe('ai_bot_v2')
  })
  it('collapses multiple underscores', () => {
    expect(sanitizeEvoseAppName('foo  --  bar')).toBe('foo_bar')
  })
  it('strips leading/trailing underscores', () => {
    expect(sanitizeEvoseAppName('  _hello_ ')).toBe('hello')
  })
  it('truncates to 40 chars', () => {
    expect(sanitizeEvoseAppName('a'.repeat(50))).toHaveLength(40)
  })
  it('returns empty string for all-special input', () => {
    expect(sanitizeEvoseAppName('!!!---')).toBe('')
  })
})

describe('isEvoseToolName / isEvoseGatewayToolName', () => {
  it('returns true for gateway MCP names', () => {
    expect(isEvoseToolName('mcp__opencow-capabilities__evose_run_agent')).toBe(true)
    expect(isEvoseToolName('mcp__opencow-capabilities__evose_run_workflow')).toBe(true)
    expect(isEvoseToolName('mcp__opencow-capabilities__evose_list_apps')).toBe(true)
  })

  it('returns true for gateway local names', () => {
    expect(isEvoseToolName(EVOSE_RUN_AGENT_LOCAL_NAME)).toBe(true)
    expect(isEvoseToolName(EVOSE_RUN_WORKFLOW_LOCAL_NAME)).toBe(true)
    expect(isEvoseToolName(EVOSE_LIST_APPS_LOCAL_NAME)).toBe(true)
  })

  it('returns false for legacy dynamic names and non-evose tools', () => {
    expect(isEvoseToolName('mcp__opencow-capabilities__evose_agent_x_analyst')).toBe(false)
    expect(isEvoseToolName('mcp__opencow-capabilities__evose_workflow_data_pipeline')).toBe(false)
    expect(isEvoseToolName('mcp__opencow-capabilities__browser_navigate')).toBe(false)
    expect(isEvoseToolName('Bash')).toBe(false)
  })

  it('isEvoseGatewayToolName delegates to gateway-only matcher', () => {
    expect(isEvoseGatewayToolName('mcp__opencow-capabilities__evose_run_agent')).toBe(true)
    expect(isEvoseGatewayToolName('mcp__opencow-capabilities__evose_agent_foo')).toBe(false)
  })
})

describe('extractEvoseLocalName', () => {
  it('extracts local name from full MCP name', () => {
    expect(extractEvoseLocalName('mcp__opencow-capabilities__evose_run_agent')).toBe('evose_run_agent')
  })

  it('returns input as-is when name is already local', () => {
    expect(extractEvoseLocalName('evose_run_workflow')).toBe('evose_run_workflow')
  })

  it('returns input as-is for other MCP servers', () => {
    expect(extractEvoseLocalName('mcp__other-server__evose_run_agent')).toBe('mcp__other-server__evose_run_agent')
  })
})

describe('resolveEvoseAppInfo', () => {
  const apps = [
    { appId: 'agent-1', name: 'Customer Support', type: 'agent' as const, enabled: true, avatar: 'https://a.example/avatar.png' },
    { appId: 'wf-1', name: 'Data Processor', type: 'workflow' as const, enabled: true, avatar: 'https://b.example/avatar.png' },
  ]

  it('returns matched app info for run_agent by app_id', () => {
    expect(resolveEvoseAppInfo(
      'mcp__opencow-capabilities__evose_run_agent',
      apps,
      { app_id: 'agent-1' },
    )).toEqual({
      displayName: 'Customer Support',
      avatar: 'https://a.example/avatar.png',
      appType: 'agent',
    })
  })

  it('returns matched app info for run_workflow by app_id', () => {
    expect(resolveEvoseAppInfo(
      'mcp__opencow-capabilities__evose_run_workflow',
      apps,
      { app_id: 'wf-1' },
    )).toEqual({
      displayName: 'Data Processor',
      avatar: 'https://b.example/avatar.png',
      appType: 'workflow',
    })
  })

  it('returns deterministic fallback when app_id is unknown', () => {
    expect(resolveEvoseAppInfo(
      'mcp__opencow-capabilities__evose_run_agent',
      apps,
      { app_id: 'agent-missing' },
    )).toEqual({
      displayName: 'Evose Agent (agent-missing)',
      avatar: undefined,
      appType: 'agent',
    })
  })

  it('returns catalog info for list_apps', () => {
    expect(resolveEvoseAppInfo('mcp__opencow-capabilities__evose_list_apps', apps))
      .toEqual({
        displayName: 'Evose Apps',
        appType: 'catalog',
      })
  })

  it('returns null for non-evose tools', () => {
    expect(resolveEvoseAppInfo('Bash', apps)).toBeNull()
  })
})
