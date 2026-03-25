// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useNoteContentResolver } from '../../../src/renderer/hooks/useNoteContentResolver'
import { ProjectScopeProvider } from '../../../src/renderer/contexts/ProjectScopeContext'
import type { SessionNote } from '../../../src/shared/types'

function makeNote(overrides: Partial<SessionNote> = {}): SessionNote {
  return {
    id: 'note-1',
    issueId: 'issue-1',
    content: {
      text: 'hello note',
      ...overrides.content,
    },
    sourceFilePath: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

function createWrapper(projectPath?: string) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ProjectScopeProvider projectPath={projectPath}>
        {children}
      </ProjectScopeProvider>
    )
  }
}

describe('useNoteContentResolver', () => {
  const mockReadCapabilitySource = vi.fn<(sourcePath: string, projectPath?: string) => Promise<{ content: string }>>()

  beforeEach(() => {
    vi.clearAllMocks()
    mockReadCapabilitySource.mockResolvedValue({ content: '' })
    ;(window as any).opencow = {
      'read-capability-source': mockReadCapabilitySource,
    }
  })

  it('returns plain text when note has no slash mentions or images', async () => {
    const { result } = renderHook(() => useNoteContentResolver(), {
      wrapper: createWrapper('/project-a'),
    })

    const resolved = await result.current(
      makeNote({
        content: {
          text: 'plain note text',
          richContent: undefined,
          images: undefined,
        },
      }),
    )

    expect(resolved).toBe('plain note text')
    expect(mockReadCapabilitySource).not.toHaveBeenCalled()
  })

  it('returns text + image blocks when note has images without slash mentions', async () => {
    const { result } = renderHook(() => useNoteContentResolver(), {
      wrapper: createWrapper('/project-a'),
    })

    const resolved = await result.current(
      makeNote({
        content: {
          text: 'image note',
          richContent: undefined,
          images: [
            {
              id: 'img-1',
              mediaType: 'image/png',
              data: 'base64-image-data',
              sizeBytes: 1234,
            },
          ],
        },
      }),
    )

    expect(resolved).toEqual([
      { type: 'text', text: 'image note' },
      {
        type: 'image',
        mediaType: 'image/png',
        data: 'base64-image-data',
        sizeBytes: 1234,
      },
    ])
    expect(mockReadCapabilitySource).not.toHaveBeenCalled()
  })

  it('returns slash_command blocks and appends note images', async () => {
    mockReadCapabilitySource.mockResolvedValue({
      content: `---
name: skill
---
Expanded body from source`,
    })

    const { result } = renderHook(() => useNoteContentResolver(), {
      wrapper: createWrapper('/project-slash'),
    })

    const richContent = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'before ' },
            {
              type: 'slashMention',
              attrs: {
                name: 'my-skill',
                category: 'skill',
                sourcePath: '/capabilities/my-skill.md',
                label: 'My Skill',
              },
            },
            { type: 'text', text: ' after' },
          ],
        },
      ],
    })

    const resolved = await result.current(
      makeNote({
        content: {
          text: 'fallback text',
          richContent,
          images: [
            {
              id: 'img-2',
              mediaType: 'image/jpeg',
              data: 'img-jpeg-data',
              sizeBytes: 2048,
            },
          ],
        },
      }),
    )

    expect(resolved).toEqual([
      { type: 'text', text: 'before ' },
      {
        type: 'slash_command',
        name: 'my-skill',
        category: 'skill',
        label: 'My Skill',
        expandedText: 'Expanded body from source',
      },
      { type: 'text', text: ' after' },
      {
        type: 'image',
        mediaType: 'image/jpeg',
        data: 'img-jpeg-data',
        sizeBytes: 2048,
      },
    ])
    expect(mockReadCapabilitySource).toHaveBeenCalledWith('/capabilities/my-skill.md', '/project-slash')
  })
})
