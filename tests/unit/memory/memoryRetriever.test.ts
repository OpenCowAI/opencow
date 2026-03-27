// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest'
import { MemoryRetriever } from '../../../electron/memory/memoryRetriever'
import type { MemoryItem } from '@shared/types'

function makeMemory(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: `mem-${Math.random().toString(36).slice(2, 8)}`,
    scope: 'user',
    projectId: null,
    content: 'Test memory content',
    category: 'preference',
    tags: [],
    confidence: 0.8,
    source: 'session',
    sourceId: null,
    reasoning: null,
    status: 'confirmed',
    confirmedBy: 'user',
    version: 1,
    previousId: null,
    accessCount: 0,
    lastAccessedAt: null,
    expiresAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

function createMockStore(projectMemories: MemoryItem[] = [], userMemories: MemoryItem[] = []) {
  return {
    search: vi.fn().mockImplementation(async (params: { scope?: string }) => {
      if (params.scope === 'project') return projectMemories
      if (params.scope === 'user') return userMemories
      return [...projectMemories, ...userMemories]
    }),
  } as unknown as import('../../../electron/memory/storage/types').IMemoryStorage
}

describe('MemoryRetriever', () => {
  it('should return empty context when no memories exist', async () => {
    const store = createMockStore()
    const retriever = new MemoryRetriever(store)

    const context = await retriever.getContextForSession({ projectId: 'proj-1' })

    expect(context.memories).toHaveLength(0)
    expect(context.formatted).toBe('')
  })

  it('should include both project and user memories', async () => {
    const projectMems = [makeMemory({ scope: 'project', content: 'Uses Tailwind CSS', category: 'convention' })]
    const userMems = [makeMemory({ scope: 'user', content: 'Prefers Chinese', category: 'preference', tags: ['language'] })]
    const store = createMockStore(projectMems, userMems)
    const retriever = new MemoryRetriever(store)

    const context = await retriever.getContextForSession({ projectId: 'proj-1' })

    expect(context.memories).toHaveLength(2)
    expect(context.formatted).toContain('Uses Tailwind CSS')
    expect(context.formatted).toContain('Prefers Chinese')
  })

  it('should format with opencow-memory XML tags', async () => {
    const userMems = [makeMemory({ scope: 'user', content: 'Senior engineer' })]
    const store = createMockStore([], userMems)
    const retriever = new MemoryRetriever(store)

    const context = await retriever.getContextForSession({ projectId: 'proj-1' })

    expect(context.formatted).toContain('<opencow-memory>')
    expect(context.formatted).toContain('</opencow-memory>')
    expect(context.formatted).toContain('## User Profile')
  })

  it('should separate project and user sections', async () => {
    const projectMems = [makeMemory({ scope: 'project', content: 'Project fact', category: 'convention' })]
    const userMems = [makeMemory({ scope: 'user', content: 'User fact', category: 'background', tags: ['role'] })]
    const store = createMockStore(projectMems, userMems)
    const retriever = new MemoryRetriever(store)

    const context = await retriever.getContextForSession({ projectId: 'proj-1' })

    expect(context.formatted).toContain('## User Profile')
    expect(context.formatted).toContain('## Project Context')
  })

  it('should respect token budget', async () => {
    // Create many memories that would exceed budget
    const memories = Array.from({ length: 50 }, (_, i) =>
      makeMemory({
        scope: 'user',
        content: `Memory item number ${i} with some padding text to consume tokens`,
        confidence: 0.9,
      }),
    )
    const store = createMockStore([], memories)
    const retriever = new MemoryRetriever(store)

    const context = await retriever.getContextForSession({
      projectId: 'proj-1',
      tokenBudget: 200, // Very small budget
    })

    // Should have fewer memories than available
    expect(context.memories.length).toBeLessThan(50)
    expect(context.tokenCount).toBeLessThanOrEqual(200)
  })

  it('should include category in formatted output', async () => {
    const mems = [makeMemory({ scope: 'user', content: 'Prefers dark mode', category: 'preference' })]
    const store = createMockStore([], mems)
    const retriever = new MemoryRetriever(store)

    const context = await retriever.getContextForSession({ projectId: 'proj-1' })

    expect(context.formatted).toContain('[preference]')
  })
})
