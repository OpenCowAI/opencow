// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { ManagedSessionMessage } from '../../../src/shared/types'
import { mapManagedMessagesToSdkInitialMessages } from '../../../electron/command/sdkHistoryMapper'

describe('sdkHistoryMapper', () => {
  it('maps user/assistant text history and skips system/tool-only blocks', () => {
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
      {
        id: 'a-2',
        role: 'assistant',
        timestamp: 1_700_000_003_000,
        content: [{ type: 'tool_result', toolUseId: 'tool-1', content: 'ok' }],
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
        content: [{ type: 'text', text: 'done' }],
      },
    })
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
