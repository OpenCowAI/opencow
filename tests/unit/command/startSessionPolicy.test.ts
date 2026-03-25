// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { resolveStartSessionPolicy } from '../../../electron/command/policy/startSessionPolicy'

describe('resolveStartSessionPolicy', () => {
  it('builds defaults when no policy is provided', () => {
    const resolved = resolveStartSessionPolicy({
      engineKind: 'codex',
    })

    expect(resolved).toEqual({
      tools: {
        builtin: { enabled: true },
        native: {
          mode: 'none',
          allow: [],
        },
      },
      capabilities: {
        skill: {
          maxChars: 24000,
          explicit: [],
          implicitQuery: undefined,
        },
      },
    })
  })

  it('respects mode=none and clears allowlist', () => {
    const resolved = resolveStartSessionPolicy({
      engineKind: 'claude',
      policy: {
        tools: {
          builtin: { enabled: false },
          native: {
            mode: 'none',
            allow: [{ capability: 'browser' }],
          },
        },
        capabilities: {
          skill: {
            maxChars: 80000,
            explicit: ['docs-sync'],
          },
        },
      },
    })

    expect(resolved.tools.builtin.enabled).toBe(false)
    expect(resolved.tools.native.mode).toBe('none')
    expect(resolved.tools.native.allow).toEqual([])
  })

  it('infers mode=allowlist when allowlist entries are provided without mode', () => {
    const resolved = resolveStartSessionPolicy({
      engineKind: 'claude',
      policy: {
        tools: {
          native: {
            allow: [{ capability: 'browser' }],
          },
        },
      },
    })

    expect(resolved.tools.native.mode).toBe('allowlist')
    expect(resolved.tools.native.allow).toEqual([{ capability: 'browser' }])
  })

  it('normalizes allowlist and skill fields', () => {
    const resolved = resolveStartSessionPolicy({
      engineKind: 'claude',
      policy: {
        tools: {
          builtin: { enabled: true },
          native: {
            mode: 'allowlist',
            allow: [
              { capability: ' browser ' },
              { capability: 'browser', tool: ' list_tabs ' },
              { capability: 'browser', tool: 'list_tabs' },
            ],
          },
        },
        capabilities: {
          skill: {
            maxChars: 12345,
            explicit: [' docs-sync ', 'docs-sync', ''],
            implicitQuery: '  sync docs  ',
          },
        },
      },
    })

    expect(resolved.tools.native.allow).toEqual([
      { capability: 'browser' },
      { capability: 'browser', tool: 'list_tabs' },
    ])
    expect(resolved.capabilities.skill.maxChars).toBe(12345)
    expect(resolved.capabilities.skill.explicit).toEqual(['docs-sync'])
    expect(resolved.capabilities.skill.implicitQuery).toBe('sync docs')
  })
})
