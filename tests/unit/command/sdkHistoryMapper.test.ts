// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { ManagedSessionMessage } from '../../../src/shared/types'
import { mapManagedMessagesToSdkInitialMessages } from '../../../electron/command/sdkHistoryMapper'

describe('sdkHistoryMapper', () => {
  it('preserves tool_use on assistant turns and skips system events', () => {
    // Lossless replay: tool_use blocks MUST survive the round-trip.  Previously
    // they were stripped, which broke per-turn resume because the SDK rejects
    // a user-role tool_result that has no matching assistant-role tool_use.
    const messages: ManagedSessionMessage[] = [
      {
        id: 'u-1',
        role: 'user',
        timestamp: 1_700_000_000_000,
        content: [{ type: 'text', text: 'hello' }],
      },
      {
        id: 'a-1',
        role: 'assistant',
        timestamp: 1_700_000_001_000,
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } },
          { type: 'text', text: 'done' },
        ],
      },
      {
        id: 's-1',
        role: 'system',
        timestamp: 1_700_000_002_000,
        event: {
          type: 'hook',
          hookId: 'hook-1',
          hookName: 'PreToolUse',
          hookTrigger: 'PreToolUse',
        },
      },
    ]

    const mapped = mapManagedMessagesToSdkInitialMessages(messages)
    expect(mapped).toHaveLength(2)

    const [user, assistant] = mapped as Array<Record<string, unknown>>

    expect(user.type).toBe('user')
    expect(user.message).toMatchObject({
      role: 'user',
      content: 'hello',
    })

    expect(assistant.type).toBe('assistant')
    expect(assistant).toMatchObject({
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } },
          { type: 'text', text: 'done' },
        ],
      },
    })
  })

  it('folds extracted screenshot media back into tool_result.content for SDK replay', () => {
    // Bug repro: a browser_screenshot tool call whose returned PNG was
    // extracted into a sibling ImageBlock stamped with the originating toolUseId.  On resume, the Anthropic API requires that
    // image to live INSIDE the tool_result.content array — not as a sibling —
    // otherwise the model never sees it on the next turn.
    const messages: ManagedSessionMessage[] = [
      {
        id: 'u-1',
        role: 'user',
        timestamp: 1_700_000_000_000,
        content: [{ type: 'text', text: 'open x.com and take a screenshot' }],
      },
      {
        id: 'a-1',
        role: 'assistant',
        timestamp: 1_700_000_001_000,
        content: [
          { type: 'tool_use', id: 'tool-shot', name: 'browser_screenshot', input: {} },
        ],
      },
      {
        id: 'u-tr',
        role: 'user',
        timestamp: 1_700_000_002_000,
        content: [
          { type: 'tool_result', toolUseId: 'tool-shot', content: '' },
          {
            type: 'image',
            mediaType: 'image/png',
            data: 'iVBORw0KGgo=',
            sizeBytes: 9,
            toolUseId: 'tool-shot',
          },
        ],
      },
    ]

    const mapped = mapManagedMessagesToSdkInitialMessages(messages)
    expect(mapped).toHaveLength(3)

    const toolResultUser = mapped[2] as Record<string, unknown>
    expect(toolResultUser.type).toBe('user')
    expect(toolResultUser).toMatchObject({
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-shot',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'iVBORw0KGgo=',
                },
              },
            ],
          },
        ],
      },
    })

    // Provenance-stamped image must NOT leak as a sibling block — that would
    // double-feed the model and look like an unsolicited user image.
    const userContent = (toolResultUser.message as { content: unknown[] }).content
    expect(userContent).toHaveLength(1)
  })

  it('infers stop_reason from content: tool_use vs end_turn', () => {
    // Anthropic protocol compliance: a hardcoded 'stop_sequence' for all
    // replayed assistant messages (previous behaviour) is wrong for turns
    // that ended on tool_use (should be 'tool_use') or plain text completion
    // (should be 'end_turn'). Bug history: plans/per-turn-history-replay.md §5.2.
    const messages: ManagedSessionMessage[] = [
      { id: 'u-1', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'hi' }] },
      {
        id: 'a-tool',
        role: 'assistant',
        timestamp: 2,
        content: [
          { type: 'tool_use', id: 't-1', name: 'Bash', input: { command: 'ls' } },
        ],
      },
      {
        id: 'u-2',
        role: 'user',
        timestamp: 3,
        content: [{ type: 'tool_result', toolUseId: 't-1', content: 'ok' }],
      },
      {
        id: 'a-text',
        role: 'assistant',
        timestamp: 4,
        content: [{ type: 'text', text: 'done' }],
      },
    ]

    const mapped = mapManagedMessagesToSdkInitialMessages(messages) as Array<{
      type: string
      message: { stop_reason: string; content: Array<{ type: string }> }
    }>

    const toolUseAssistant = mapped.find(
      (m) => m.type === 'assistant' && m.message.content.some((b) => b.type === 'tool_use'),
    )!
    expect(toolUseAssistant.message.stop_reason).toBe('tool_use')

    const textAssistant = mapped.find(
      (m) => m.type === 'assistant' && m.message.content.every((b) => b.type === 'text'),
    )!
    expect(textAssistant.message.stop_reason).toBe('end_turn')
  })

  it('uses real model name, not the SDK-internal <synthetic> sentinel', () => {
    // '<synthetic>' is the opencow-agent-sdk sentinel for locally-generated
    // placeholder assistant messages; some normalisation paths in the SDK
    // treat it specially. Replayed host history should look like a real
    // transcript at the API layer.
    const messages: ManagedSessionMessage[] = [
      {
        id: 'a-1',
        role: 'assistant',
        timestamp: 1,
        content: [{ type: 'text', text: 'hi' }],
      },
    ]

    // Default fallback
    const defaulted = mapManagedMessagesToSdkInitialMessages(messages) as Array<{
      message: { model: string }
    }>
    expect(defaulted[0]!.message.model).not.toBe('<synthetic>')
    expect(defaulted[0]!.message.model).toMatch(/^claude-/)

    // Caller-supplied model wins
    const withModel = mapManagedMessagesToSdkInitialMessages(messages, {
      model: 'claude-opus-4-5',
    }) as Array<{ message: { model: string } }>
    expect(withModel[0]!.message.model).toBe('claude-opus-4-5')
  })

  it('uses stable ManagedSessionMessage.id for assistant message.id', () => {
    // Stable id lets SDK's consecutive-same-id merge path work correctly,
    // and makes mapper output deterministic across replays.
    const messages: ManagedSessionMessage[] = [
      {
        id: 'stable-id-xyz',
        role: 'assistant',
        timestamp: 1,
        content: [{ type: 'text', text: 'hi' }],
      },
    ]

    const first = mapManagedMessagesToSdkInitialMessages(messages) as Array<{
      message: { id: string }
    }>
    const second = mapManagedMessagesToSdkInitialMessages(messages) as Array<{
      message: { id: string }
    }>

    expect(first[0]!.message.id).toBe('stable-id-xyz')
    expect(second[0]!.message.id).toBe('stable-id-xyz')
  })

  it('merges consecutive assistant messages from the same turn (thinking + tool_use split)', () => {
    // ccb-2IZ4L16u3aIW / ccb-p-IDyPZVFH4G / ccb-IcC5mfq4EvOA all show the
    // same shape in persisted history: a thinking-only assistant entry
    // followed by a tool_use-only assistant entry, with no user message
    // between them. Anthropic's API requires strict user/assistant
    // alternation; two consecutive assistant messages trigger either a
    // 400 or silent content loss. The mapper must collapse them back into
    // one logical turn. Extended-thinking protocol also requires the
    // thinking block to come FIRST in the combined content.
    const messages: ManagedSessionMessage[] = [
      {
        id: 'u-0',
        role: 'user',
        timestamp: 1,
        content: [{ type: 'text', text: '每天 9 点分析桌面文件' }],
      },
      {
        id: 'a-thinking',
        role: 'assistant',
        timestamp: 2,
        content: [{ type: 'thinking', thinking: 'The user wants a daily schedule…' }],
      },
      {
        id: 'a-tool',
        role: 'assistant',
        timestamp: 3,
        content: [
          { type: 'tool_use', id: 'call-1', name: 'create_schedule', input: { name: 'x' } },
        ],
      },
    ]

    const mapped = mapManagedMessagesToSdkInitialMessages(messages) as Array<{
      type: string
      message: {
        content: Array<{ type: string }>
        stop_reason: string
        id: string
      }
    }>

    // After merge: user + single assistant (thinking+tool_use combined).
    expect(mapped).toHaveLength(2)
    expect(mapped[0]!.type).toBe('user')
    expect(mapped[1]!.type).toBe('assistant')

    const merged = mapped[1]!.message
    // Thinking first (extended-thinking protocol), tool_use after.
    expect(merged.content.map((b) => b.type)).toEqual(['thinking', 'tool_use'])
    // stop_reason re-inferred from combined content.
    expect(merged.stop_reason).toBe('tool_use')
    // First entry's stable id wins after merge.
    expect(merged.id).toBe('a-thinking')
  })

  it('maps mixed user content blocks to SDK-compatible structures', () => {
    const messages: ManagedSessionMessage[] = [
      {
        id: 'u-1',
        role: 'user',
        timestamp: 1_700_000_000_000,
        content: [
          { type: 'text', text: 'please review' },
          {
            type: 'image',
            mediaType: 'image/png',
            data: 'base64-image',
            sizeBytes: 12,
          },
          {
            type: 'document',
            mediaType: 'text/plain',
            data: 'doc body',
            sizeBytes: 8,
            title: 'note.txt',
          },
        ],
      },
    ]

    const mapped = mapManagedMessagesToSdkInitialMessages(messages)
    expect(mapped).toHaveLength(1)

    const only = mapped[0] as Record<string, unknown>
    expect(only.type).toBe('user')
    expect(only).toMatchObject({
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'please review' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'base64-image',
            },
          },
          {
            type: 'document',
            source: {
              type: 'text',
              media_type: 'text/plain',
              data: 'doc body',
            },
            title: 'note.txt',
          },
        ],
      },
    })
  })
})
