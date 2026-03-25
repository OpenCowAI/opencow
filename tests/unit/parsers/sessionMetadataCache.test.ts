// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FileStatCache } from '../../../electron/parsers/sessionMetadataCache'

describe('FileStatCache', () => {
  let cache: FileStatCache<string>

  beforeEach(() => {
    cache = new FileStatCache<string>()
  })

  it('returns parsed value on cache miss', async () => {
    const parse = vi.fn().mockResolvedValue('parsed-result')

    const result = await cache.get('/a.jsonl', 1000, 500, parse)

    expect(result).toBe('parsed-result')
    expect(parse).toHaveBeenCalledTimes(1)
    expect(cache.size).toBe(1)
  })

  it('returns cached value when mtime and size match', async () => {
    const parse = vi.fn().mockResolvedValue('first')

    await cache.get('/a.jsonl', 1000, 500, parse)
    const result = await cache.get('/a.jsonl', 1000, 500, parse)

    expect(result).toBe('first')
    expect(parse).toHaveBeenCalledTimes(1) // NOT called again
  })

  it('re-parses when mtime changes', async () => {
    const parse1 = vi.fn().mockResolvedValue('v1')
    const parse2 = vi.fn().mockResolvedValue('v2')

    await cache.get('/a.jsonl', 1000, 500, parse1)
    const result = await cache.get('/a.jsonl', 2000, 500, parse2)

    expect(result).toBe('v2')
    expect(parse2).toHaveBeenCalledTimes(1)
  })

  it('re-parses when size changes', async () => {
    const parse1 = vi.fn().mockResolvedValue('v1')
    const parse2 = vi.fn().mockResolvedValue('v2')

    await cache.get('/a.jsonl', 1000, 500, parse1)
    const result = await cache.get('/a.jsonl', 1000, 800, parse2)

    expect(result).toBe('v2')
    expect(parse2).toHaveBeenCalledTimes(1)
  })

  it('caches different files independently', async () => {
    const parseA = vi.fn().mockResolvedValue('a')
    const parseB = vi.fn().mockResolvedValue('b')

    await cache.get('/a.jsonl', 1000, 100, parseA)
    await cache.get('/b.jsonl', 2000, 200, parseB)

    expect(cache.size).toBe(2)

    // Both hit cache on re-read
    const a = await cache.get('/a.jsonl', 1000, 100, vi.fn())
    const b = await cache.get('/b.jsonl', 2000, 200, vi.fn())
    expect(a).toBe('a')
    expect(b).toBe('b')
  })

  it('prunes entries for removed files', async () => {
    await cache.get('/a.jsonl', 1000, 100, async () => 'a')
    await cache.get('/b.jsonl', 2000, 200, async () => 'b')
    await cache.get('/c.jsonl', 3000, 300, async () => 'c')

    cache.prune(new Set(['/a.jsonl', '/c.jsonl']))

    expect(cache.size).toBe(2)

    // /b.jsonl was pruned — next access is a cache miss
    const parse = vi.fn().mockResolvedValue('b-new')
    await cache.get('/b.jsonl', 2000, 200, parse)
    expect(parse).toHaveBeenCalledTimes(1)
  })

  it('clear removes all entries', async () => {
    await cache.get('/a.jsonl', 1000, 100, async () => 'a')
    await cache.get('/b.jsonl', 2000, 200, async () => 'b')

    cache.clear()
    expect(cache.size).toBe(0)
  })

  it('propagates parse errors without caching', async () => {
    const failingParse = vi.fn().mockRejectedValue(new Error('parse failed'))

    await expect(cache.get('/a.jsonl', 1000, 100, failingParse)).rejects.toThrow('parse failed')
    expect(cache.size).toBe(0) // Nothing cached on error
  })
})
