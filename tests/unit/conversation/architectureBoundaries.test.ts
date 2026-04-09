// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const DOMAIN_FILES = [
  'electron/conversation/domain/content.ts',
  'electron/conversation/domain/effects.ts',
  'electron/conversation/domain/events.ts',
  'electron/conversation/domain/reducer.ts',
  'electron/conversation/domain/state.ts',
]

const PROJECTION_FILES = [
  'electron/conversation/projection/contentBlockMapper.ts',
  'electron/conversation/projection/effectProjector.ts',
]

describe('conversation architecture boundaries', () => {
  it('domain layer does not import engine SDK packages', () => {
    for (const file of DOMAIN_FILES) {
      const content = readFileSync(file, 'utf8')
      expect(content.includes('@anthropic-ai/claude-agent-sdk')).toBe(false)
      expect(content.includes('@opencow-ai/opencow-agent-sdk')).toBe(false)
      expect(content.includes('@openai/codex-sdk')).toBe(false)
    }
  })

  it('projection layer does not import engine SDK packages', () => {
    for (const file of PROJECTION_FILES) {
      const content = readFileSync(file, 'utf8')
      expect(content.includes('@anthropic-ai/claude-agent-sdk')).toBe(false)
      expect(content.includes('@opencow-ai/opencow-agent-sdk')).toBe(false)
      expect(content.includes('@openai/codex-sdk')).toBe(false)
    }
  })

  it('legacy sdk router stack is removed from command layer', () => {
    expect(existsSync('electron/command/createEventRouter.ts')).toBe(false)
    expect(existsSync('electron/command/sdkEventRouter.ts')).toBe(false)
    expect(existsSync('electron/command/sdkTypeGuards.ts')).toBe(false)
    expect(existsSync('electron/command/handlers/handleResult.ts')).toBe(false)
    expect(existsSync('electron/command/handlers/handlePartialMessage.ts')).toBe(false)
    expect(existsSync('electron/command/codex/codexTurnProjector.ts')).toBe(false)
    expect(existsSync('electron/conversation/runtime/codex/codexTurnProjector.ts')).toBe(true)
  })
})
