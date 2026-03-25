// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { readAllLines, readLinesFromStream } from '../../../electron/io/safeReadLines'

describe('readAllLines', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'opencow-io-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('reads all lines from a file', async () => {
    const filePath = join(tmpDir, 'test.jsonl')
    await writeFile(filePath, 'line1\nline2\nline3\n')

    const lines = await readAllLines(filePath)
    expect(lines).toEqual(['line1', 'line2', 'line3'])
  })

  it('returns empty array for empty file', async () => {
    const filePath = join(tmpDir, 'empty.jsonl')
    await writeFile(filePath, '')

    const lines = await readAllLines(filePath)
    expect(lines).toEqual([])
  })

  it('handles file with no trailing newline', async () => {
    const filePath = join(tmpDir, 'no-eol.jsonl')
    await writeFile(filePath, 'line1\nline2')

    const lines = await readAllLines(filePath)
    expect(lines).toEqual(['line1', 'line2'])
  })

  it('throws on non-existent file', async () => {
    await expect(
      readAllLines(join(tmpDir, 'missing.jsonl'))
    ).rejects.toThrow()
  })
})

describe('readLinesFromStream', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'opencow-io-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('reads all lines when no options specified', async () => {
    const filePath = join(tmpDir, 'test.jsonl')
    await writeFile(filePath, 'line1\nline2\nline3\n')

    const lines = await readLinesFromStream(filePath)
    expect(lines).toEqual(['line1', 'line2', 'line3'])
  })

  it('respects maxLines limit', async () => {
    const filePath = join(tmpDir, 'test.jsonl')
    await writeFile(filePath, 'a\nb\nc\nd\ne\n')

    const lines = await readLinesFromStream(filePath, { maxLines: 3 })
    expect(lines).toEqual(['a', 'b', 'c'])
  })

  it('supports start byte offset', async () => {
    const filePath = join(tmpDir, 'offset.jsonl')
    // "hello\nworld\n" — 'hello\n' is 6 bytes
    await writeFile(filePath, 'hello\nworld\n')

    const lines = await readLinesFromStream(filePath, { start: 6 })
    expect(lines).toEqual(['world'])
  })

  it('returns empty array for empty file', async () => {
    const filePath = join(tmpDir, 'empty.jsonl')
    await writeFile(filePath, '')

    const lines = await readLinesFromStream(filePath)
    expect(lines).toEqual([])
  })

  it('handles file with no trailing newline', async () => {
    const filePath = join(tmpDir, 'no-eol.jsonl')
    await writeFile(filePath, 'line1\nline2')

    const lines = await readLinesFromStream(filePath)
    expect(lines).toEqual(['line1', 'line2'])
  })

  it('cleans up FD even when maxLines causes early exit', async () => {
    const filePath = join(tmpDir, 'large.jsonl')
    const lines = Array.from({ length: 1000 }, (_, i) => `line${i}`)
    await writeFile(filePath, lines.join('\n') + '\n')

    // Read only first 5 lines — should not leak the FD
    const result = await readLinesFromStream(filePath, { maxLines: 5 })
    expect(result).toHaveLength(5)
    expect(result[0]).toBe('line0')
    expect(result[4]).toBe('line4')
  })

  it('throws on non-existent file', async () => {
    await expect(
      readLinesFromStream(join(tmpDir, 'missing.jsonl'))
    ).rejects.toThrow()
  })
})
