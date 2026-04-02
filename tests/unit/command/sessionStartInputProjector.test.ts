// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { StartSessionInput } from '../../../src/shared/types'
import { projectStartSessionInput } from '../../../electron/command/sessionStartInputProjector'

describe('projectStartSessionInput', () => {
  it('rejects backend-only fields from mixed payloads', () => {
    const raw = {
      prompt: 'analyze repo',
      origin: { source: 'agent' as const },
      engineKind: 'codex' as const,
      customMcpServers: {
        injected: { command: 'node', args: ['evil.mjs'] },
      },
      onComplete: () => undefined,
    } as StartSessionInput & {
      customMcpServers?: Record<string, unknown>
      onComplete?: () => void
    }

    expect(() => projectStartSessionInput(raw)).toThrowError(/Invalid start-session payload/)
    expect(() => projectStartSessionInput(raw)).toThrowError(/customMcpServers/)
    expect(() => projectStartSessionInput(raw)).toThrowError(/onComplete/)
  })

  it('preserves all shared StartSessionInput fields', () => {
    const input: StartSessionInput = {
      prompt: [{ type: 'text', text: 'hello' }],
      origin: { source: 'issue', issueId: 'issue-1' },
      engineKind: 'claude',
      workspace: { scope: 'project', projectId: 'project-1' },
      model: 'gpt-5.4',
      maxTurns: 8,
      systemPrompt: 'system',
      policy: {
        tools: {
          builtin: { enabled: false },
          native: {
            mode: 'allowlist',
            allow: [{ capability: 'browser' }, { capability: 'issues', tool: 'list_issues' }],
          },
        },
        capabilities: {
          skill: {
            maxChars: 24000,
            explicit: ['docs-sync'],
            implicitQuery: 'sync docs',
          },
        },
      },
      contextSystemPrompt: 'resolved context',
    }

    const projected = projectStartSessionInput(input)

    expect(projected).toEqual(input)
  })

  it('rejects malformed prompt payloads', () => {
    const raw = {
      prompt: 123,
      origin: { source: 'agent' as const },
    }

    expect(() => projectStartSessionInput(raw)).toThrowError(/Invalid start-session payload/)
  })

  it('rejects legacy flat tool policy fields', () => {
    const raw = {
      prompt: 'hello',
      origin: { source: 'agent' as const },
      capabilityCategories: ['browser'],
      disableBuiltinTools: true,
    }

    expect(() => projectStartSessionInput(raw)).toThrowError(/Invalid start-session payload/)
    expect(() => projectStartSessionInput(raw)).toThrowError(/capabilityCategories/)
    expect(() => projectStartSessionInput(raw)).toThrowError(/disableBuiltinTools/)
  })
})
