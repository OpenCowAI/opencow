// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest'
import { expandSlashSegments, resolveSlashSegments, type EditorSegment } from '@shared/slashExpander'

describe('expandSlashSegments', () => {
  const noopRead = async (_path: string): Promise<string> => ''

  it('returns plain text unchanged', async () => {
    const segments: EditorSegment[] = [{ type: 'text', text: 'Hello world' }]
    const result = await expandSlashSegments(segments, noopRead)
    expect(result).toEqual({ text: 'Hello world', expanded: false })
  })

  it('keeps builtin mentions as /<name>', async () => {
    const segments: EditorSegment[] = [
      { type: 'slashMention', name: 'compact', category: 'builtin' },
    ]
    const result = await expandSlashSegments(segments, noopRead)
    expect(result).toEqual({ text: '/compact', expanded: false })
  })

  it('expands command mention with sourcePath', async () => {
    const segments: EditorSegment[] = [
      { type: 'slashMention', name: 'yg.code.quality', category: 'command', sourcePath: '/path/to/cmd.md' },
    ]
    const readSource = vi.fn().mockResolvedValue('---\nname: yg.code.quality\n---\n\nReview the code quality.')
    const result = await expandSlashSegments(segments, readSource)

    expect(readSource).toHaveBeenCalledWith('/path/to/cmd.md')
    expect(result).toEqual({ text: 'Review the code quality.', expanded: true })
  })

  it('expands skill mention with sourcePath', async () => {
    const segments: EditorSegment[] = [
      { type: 'slashMention', name: 'brainstorming', category: 'skill', sourcePath: '/path/to/skill.md' },
    ]
    const readSource = vi.fn().mockResolvedValue('---\nname: brainstorming\n---\n\nBrainstorm ideas.')
    const result = await expandSlashSegments(segments, readSource)

    expect(result).toEqual({ text: 'Brainstorm ideas.', expanded: true })
  })

  it('handles mixed mentions and text correctly', async () => {
    const segments: EditorSegment[] = [
      { type: 'text', text: 'Please ' },
      { type: 'slashMention', name: 'yg.code.quality', category: 'command', sourcePath: '/path/cmd.md' },
      { type: 'text', text: ' for this file' },
    ]
    const readSource = vi.fn().mockResolvedValue('---\nname: test\n---\n\nDo code review.')
    const result = await expandSlashSegments(segments, readSource)

    expect(result).toEqual({ text: 'Please Do code review. for this file', expanded: true })
  })

  it('falls back to /<name> when sourcePath is missing', async () => {
    const segments: EditorSegment[] = [
      { type: 'slashMention', name: 'unknown', category: 'command' },
    ]
    const result = await expandSlashSegments(segments, noopRead)
    expect(result).toEqual({ text: '/unknown', expanded: false })
  })

  it('falls back to /<name> on readSource error', async () => {
    const segments: EditorSegment[] = [
      { type: 'slashMention', name: 'failing', category: 'command', sourcePath: '/bad/path.md' },
    ]
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const readSource = vi.fn().mockRejectedValue(new Error('File not found'))
    const result = await expandSlashSegments(segments, readSource)

    expect(result).toEqual({ text: '/failing', expanded: false })
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('expands content without frontmatter as-is', async () => {
    const segments: EditorSegment[] = [
      { type: 'slashMention', name: 'simple', category: 'command', sourcePath: '/path/simple.md' },
    ]
    const readSource = vi.fn().mockResolvedValue('Just plain content, no frontmatter.')
    const result = await expandSlashSegments(segments, readSource)

    expect(result).toEqual({ text: 'Just plain content, no frontmatter.', expanded: true })
  })

  it('falls back to /<name> when source has empty body', async () => {
    const segments: EditorSegment[] = [
      { type: 'text', text: 'Run ' },
      { type: 'slashMention', name: 'empty-cmd', category: 'command', sourcePath: '/empty.md' },
      { type: 'text', text: ' now' },
    ]
    const readSource = vi.fn().mockResolvedValue('---\nname: empty-cmd\n---\n')
    const result = await expandSlashSegments(segments, readSource)

    expect(result).toEqual({ text: 'Run /empty-cmd now', expanded: false })
  })

  it('handles multiple expandable mentions', async () => {
    const segments: EditorSegment[] = [
      { type: 'slashMention', name: 'cmd1', category: 'command', sourcePath: '/cmd1.md' },
      { type: 'text', text: '\n' },
      { type: 'slashMention', name: 'cmd2', category: 'skill', sourcePath: '/cmd2.md' },
    ]
    const readSource = vi.fn()
      .mockResolvedValueOnce('---\nname: cmd1\n---\n\nFirst command.')
      .mockResolvedValueOnce('---\nname: cmd2\n---\n\nSecond skill.')
    const result = await expandSlashSegments(segments, readSource)

    expect(result).toEqual({ text: 'First command.\nSecond skill.', expanded: true })
    expect(readSource).toHaveBeenCalledTimes(2)
  })
})

describe('resolveSlashSegments', () => {
  const noopRead = async (_path: string): Promise<string> => ''

  it('returns text blocks for plain text', async () => {
    const segments: EditorSegment[] = [{ type: 'text', text: 'Hello world' }]
    const result = await resolveSlashSegments(segments, noopRead)
    expect(result).toEqual({
      blocks: [{ type: 'text', text: 'Hello world' }],
      hasSlashCommands: false,
    })
  })

  it('keeps builtin mentions as text blocks', async () => {
    const segments: EditorSegment[] = [
      { type: 'slashMention', name: 'compact', category: 'builtin' },
    ]
    const result = await resolveSlashSegments(segments, noopRead)
    expect(result).toEqual({
      blocks: [{ type: 'text', text: '/compact' }],
      hasSlashCommands: false,
    })
  })

  it('produces slash_command block for expandable command', async () => {
    const segments: EditorSegment[] = [
      { type: 'slashMention', name: 'yg.code.quality', category: 'command', sourcePath: '/path/cmd.md' },
    ]
    const readSource = vi.fn().mockResolvedValue('---\nname: yg.code.quality\n---\n\nReview the code quality.')
    const result = await resolveSlashSegments(segments, readSource)

    expect(result).toEqual({
      blocks: [{
        type: 'slash_command',
        name: 'yg.code.quality',
        category: 'command',
        label: 'yg.code.quality',
        expandedText: 'Review the code quality.',
      }],
      hasSlashCommands: true,
    })
  })

  it('produces slash_command block for skill', async () => {
    const segments: EditorSegment[] = [
      { type: 'slashMention', name: 'brainstorming', category: 'skill', sourcePath: '/path/skill.md' },
    ]
    const readSource = vi.fn().mockResolvedValue('---\nname: brainstorming\n---\n\nBrainstorm ideas.')
    const result = await resolveSlashSegments(segments, readSource)

    expect(result).toEqual({
      blocks: [{
        type: 'slash_command',
        name: 'brainstorming',
        category: 'skill',
        label: 'brainstorming',
        expandedText: 'Brainstorm ideas.',
      }],
      hasSlashCommands: true,
    })
  })

  it('handles mixed text + slash_command blocks', async () => {
    const segments: EditorSegment[] = [
      { type: 'text', text: 'Please ' },
      { type: 'slashMention', name: 'yg.code.quality', category: 'command', sourcePath: '/cmd.md' },
      { type: 'text', text: ' for this file' },
    ]
    const readSource = vi.fn().mockResolvedValue('---\nname: test\n---\n\nDo code review.')
    const result = await resolveSlashSegments(segments, readSource)

    expect(result).toEqual({
      blocks: [
        { type: 'text', text: 'Please ' },
        {
          type: 'slash_command',
          name: 'yg.code.quality',
          category: 'command',
          label: 'yg.code.quality',
          expandedText: 'Do code review.',
        },
        { type: 'text', text: ' for this file' },
      ],
      hasSlashCommands: true,
    })
  })

  it('falls back to text when sourcePath is missing', async () => {
    const segments: EditorSegment[] = [
      { type: 'slashMention', name: 'unknown', category: 'command' },
    ]
    const result = await resolveSlashSegments(segments, noopRead)
    expect(result).toEqual({
      blocks: [{ type: 'text', text: '/unknown' }],
      hasSlashCommands: false,
    })
  })

  it('falls back to text on readSource error', async () => {
    const segments: EditorSegment[] = [
      { type: 'slashMention', name: 'failing', category: 'command', sourcePath: '/bad.md' },
    ]
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const readSource = vi.fn().mockRejectedValue(new Error('File not found'))
    const result = await resolveSlashSegments(segments, readSource)

    expect(result).toEqual({
      blocks: [{ type: 'text', text: '/failing' }],
      hasSlashCommands: false,
    })
    consoleSpy.mockRestore()
  })

  it('falls back to text when source has empty body', async () => {
    const segments: EditorSegment[] = [
      { type: 'slashMention', name: 'empty', category: 'command', sourcePath: '/empty.md' },
    ]
    const readSource = vi.fn().mockResolvedValue('---\nname: empty\n---\n')
    const result = await resolveSlashSegments(segments, readSource)

    expect(result).toEqual({
      blocks: [{ type: 'text', text: '/empty' }],
      hasSlashCommands: false,
    })
  })

  it('merges adjacent text blocks', async () => {
    const segments: EditorSegment[] = [
      { type: 'text', text: 'Hello ' },
      { type: 'slashMention', name: 'compact', category: 'builtin' },
      { type: 'text', text: ' world' },
    ]
    const result = await resolveSlashSegments(segments, noopRead)

    // builtin → text "/compact", adjacent text blocks should merge
    expect(result).toEqual({
      blocks: [{ type: 'text', text: 'Hello /compact world' }],
      hasSlashCommands: false,
    })
  })

  it('does not merge text across slash_command blocks', async () => {
    const segments: EditorSegment[] = [
      { type: 'text', text: 'before ' },
      { type: 'slashMention', name: 'cmd', category: 'command', sourcePath: '/cmd.md' },
      { type: 'text', text: ' after' },
    ]
    const readSource = vi.fn().mockResolvedValue('Body content')
    const result = await resolveSlashSegments(segments, readSource)

    expect(result.blocks).toHaveLength(3)
    expect(result.blocks[0]).toEqual({ type: 'text', text: 'before ' })
    expect(result.blocks[1]).toEqual({
      type: 'slash_command',
      name: 'cmd',
      category: 'command',
      label: 'cmd',
      expandedText: 'Body content',
    })
    expect(result.blocks[2]).toEqual({ type: 'text', text: ' after' })
  })
})
