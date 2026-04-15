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
