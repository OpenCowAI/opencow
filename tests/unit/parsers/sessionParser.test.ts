// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { inferStatus, parseSessionMetadata, discoverProjects } from '../../../electron/parsers/sessionParser'

function jsonl(...entries: Record<string, unknown>[]): string {
  return entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
}

describe('sessionParser', () => {
  describe('inferStatus', () => {
    const now = Date.now()

    it('returns active when last activity < 30s ago', () => {
      expect(inferStatus(now - 10_000, now)).toBe('active')
    })

    it('returns active at 29s', () => {
      expect(inferStatus(now - 29_000, now)).toBe('active')
    })

    it('returns waiting when last activity 30s-5min ago', () => {
      expect(inferStatus(now - 60_000, now)).toBe('waiting')
    })

    it('returns waiting at 4min 59s', () => {
      expect(inferStatus(now - 299_000, now)).toBe('waiting')
    })

    it('returns completed when last activity > 5min ago', () => {
      expect(inferStatus(now - 600_000, now)).toBe('completed')
    })
  })

  describe('parseSessionMetadata', () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = join(tmpdir(), `opencow-test-${Date.now()}`)
      mkdirSync(tmpDir, { recursive: true })
    })

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true })
    })

    it('extracts firstUserMessage from beginning of file', async () => {
      const file = join(tmpDir, 'test.jsonl')
      writeFileSync(
        file,
        jsonl(
          { type: 'system', cwd: '/tmp', timestamp: '2026-01-01T00:00:00Z' },
          { type: 'user', message: { role: 'user', content: 'Hello world' } },
          { type: 'assistant', message: { role: 'assistant', content: 'Hi' } },
          { type: 'user', message: { role: 'user', content: 'Latest question' } }
        )
      )
      const meta = await parseSessionMetadata(file)
      expect(meta.firstUserMessage).toEqual({ text: 'Hello world', commandName: null })
    })

    it('extracts latestUserMessage from end of file', async () => {
      const file = join(tmpDir, 'test.jsonl')
      writeFileSync(
        file,
        jsonl(
          { type: 'system', cwd: '/tmp', timestamp: '2026-01-01T00:00:00Z' },
          { type: 'user', message: { role: 'user', content: 'Hello world' } },
          { type: 'assistant', message: { role: 'assistant', content: 'Hi' } },
          { type: 'user', message: { role: 'user', content: 'Latest question' } }
        )
      )
      const meta = await parseSessionMetadata(file)
      expect(meta.latestUserMessage).toEqual({ text: 'Latest question', commandName: null })
    })

    it('returns null latestUserMessage for single-message session', async () => {
      const file = join(tmpDir, 'test.jsonl')
      writeFileSync(
        file,
        jsonl(
          { type: 'system', cwd: '/tmp', timestamp: '2026-01-01T00:00:00Z' },
          { type: 'user', message: { role: 'user', content: 'Only message' } }
        )
      )
      const meta = await parseSessionMetadata(file)
      expect(meta.firstUserMessage).toEqual({ text: 'Only message', commandName: null })
      expect(meta.latestUserMessage).toBeNull()
    })

    it('skips noise messages in tail-scan', async () => {
      const file = join(tmpDir, 'test.jsonl')
      writeFileSync(
        file,
        jsonl(
          { type: 'system', cwd: '/tmp', timestamp: '2026-01-01T00:00:00Z' },
          { type: 'user', message: { role: 'user', content: 'First real msg' } },
          { type: 'assistant', message: { role: 'assistant', content: 'Response' } },
          { type: 'user', message: { role: 'user', content: 'Second real msg' } },
          { type: 'assistant', message: { role: 'assistant', content: 'Response 2' } },
          { type: 'user', message: { role: 'user', content: '/clear' } }
        )
      )
      const meta = await parseSessionMetadata(file)
      expect(meta.latestUserMessage).toEqual({ text: 'Second real msg', commandName: null })
    })

    it('handles content block array format', async () => {
      const file = join(tmpDir, 'test.jsonl')
      writeFileSync(
        file,
        jsonl(
          { type: 'system', cwd: '/tmp', timestamp: '2026-01-01T00:00:00Z' },
          { type: 'user', message: { role: 'user', content: 'First' } },
          { type: 'assistant', message: { role: 'assistant', content: 'OK' } },
          {
            type: 'user',
            message: {
              role: 'user',
              content: [{ type: 'text', text: 'Array format latest' }]
            }
          }
        )
      )
      const meta = await parseSessionMetadata(file)
      expect(meta.latestUserMessage).toEqual({ text: 'Array format latest', commandName: null })
    })

    it('skips skill template injection after command invocation (tail scan)', async () => {
      const file = join(tmpDir, 'test.jsonl')
      writeFileSync(
        file,
        jsonl(
          { type: 'system', cwd: '/tmp', timestamp: '2026-01-01T00:00:00Z' },
          { type: 'user', message: { role: 'user', content: 'First real msg' } },
          { type: 'assistant', message: { role: 'assistant', content: 'Response' } },
          {
            type: 'user',
            message: {
              role: 'user',
              content:
                '<command-message>yg.code.quality</command-message>\n<command-name>/yg.code.quality</command-name>\n<command-args>Analyze this bug</command-args>'
            }
          },
          {
            type: 'user',
            message: {
              role: 'user',
              content:
                '# Solution Review\n\nPerform a secondary assessment of the contextual solution against code quality requirements!'
            }
          }
        )
      )
      const meta = await parseSessionMetadata(file)
      // latestUserMessage should be structured: commandName + user args text
      expect(meta.latestUserMessage).toEqual({
        text: 'Analyze this bug',
        commandName: '/yg.code.quality',
      })
    })

    it('skips skill template injection after no-args command (tail scan)', async () => {
      const file = join(tmpDir, 'test.jsonl')
      writeFileSync(
        file,
        jsonl(
          { type: 'system', cwd: '/tmp', timestamp: '2026-01-01T00:00:00Z' },
          { type: 'user', message: { role: 'user', content: 'First real msg' } },
          { type: 'assistant', message: { role: 'assistant', content: 'Response' } },
          { type: 'user', message: { role: 'user', content: 'Second question' } },
          { type: 'assistant', message: { role: 'assistant', content: 'Response 2' } },
          {
            type: 'user',
            message: {
              role: 'user',
              content:
                '<command-message>yg.code.quality</command-message>\n<command-name>/yg.code.quality</command-name>'
            }
          },
          {
            type: 'user',
            message: {
              role: 'user',
              content:
                '# Solution Review\n\nPerform a secondary assessment of the contextual solution against code quality requirements!'
            }
          }
        )
      )
      const meta = await parseSessionMetadata(file)
      // Command has no args -> filtered; skill template -> skipped
      // latestUserMessage should be 'Second question'
      expect(meta.latestUserMessage).toEqual({ text: 'Second question', commandName: null })
    })

    it('skips skill template injection in forward scan (firstUserMessage)', async () => {
      const file = join(tmpDir, 'test.jsonl')
      writeFileSync(
        file,
        jsonl(
          { type: 'system', cwd: '/tmp', timestamp: '2026-01-01T00:00:00Z' },
          {
            type: 'user',
            message: {
              role: 'user',
              content:
                '<command-message>yg.code.quality</command-message>\n<command-name>/yg.code.quality</command-name>'
            }
          },
          {
            type: 'user',
            message: {
              role: 'user',
              content:
                '# Solution Review\n\nPerform a secondary assessment of the contextual solution against code quality requirements!'
            }
          },
          { type: 'assistant', message: { role: 'assistant', content: 'OK' } },
          { type: 'user', message: { role: 'user', content: 'Real first message' } }
        )
      )
      const meta = await parseSessionMetadata(file)
      // Command no-args -> filtered; skill template -> skipped
      // firstUserMessage should be 'Real first message'
      expect(meta.firstUserMessage).toEqual({ text: 'Real first message', commandName: null })
    })
  })

  describe('discoverProjects', () => {
    it('returns DiscoveredProjectData with correct shape', async () => {
      const results = await discoverProjects()
      expect(Array.isArray(results)).toBe(true)
      for (const r of results) {
        expect(r).toHaveProperty('folderName')
        expect(r).toHaveProperty('resolvedPath')
        expect(r).toHaveProperty('name')
        expect(r).toHaveProperty('sessionFiles')
        expect(Array.isArray(r.sessionFiles)).toBe(true)
      }
    })
  })
})
