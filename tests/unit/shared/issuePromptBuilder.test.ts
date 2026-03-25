// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { buildIssuePromptText, buildIssuePrompt } from '../../../src/shared/issuePromptBuilder'

describe('buildIssuePromptText', () => {
  it('separates title, description, and instruction with blank lines', () => {
    const result = buildIssuePromptText({
      title: 'Fix login bug',
      description: 'Users cannot log in with SSO.',
    })
    expect(result).toBe(
      'Issue: Fix login bug\n\nUsers cannot log in with SSO.\n\nPlease work on this issue.'
    )
  })

  it('omits description section when empty', () => {
    const result = buildIssuePromptText({ title: 'No desc', description: '' })
    expect(result).toBe('Issue: No desc\n\nPlease work on this issue.')
  })

  it('omits description section when whitespace-only', () => {
    const result = buildIssuePromptText({ title: 'Blank', description: '  \n\n  ' })
    expect(result).toBe('Issue: Blank\n\nPlease work on this issue.')
  })

  it('preserves internal line breaks within description', () => {
    const result = buildIssuePromptText({
      title: 'T',
      description: 'Line 1\nLine 2\n\nParagraph 2',
    })
    expect(result).toBe(
      'Issue: T\n\nLine 1\nLine 2\n\nParagraph 2\n\nPlease work on this issue.'
    )
  })

  it('trims trailing whitespace from description to prevent extra blank lines', () => {
    const result = buildIssuePromptText({
      title: 'T',
      description: 'Has trailing newlines\n\n',
    })
    expect(result).toBe(
      'Issue: T\n\nHas trailing newlines\n\nPlease work on this issue.'
    )
  })

  it('produces correct line structure with description', () => {
    const lines = buildIssuePromptText({ title: 'T', description: 'D' }).split('\n')
    expect(lines).toEqual([
      'Issue: T',
      '',                           // blank line after title
      'D',
      '',                           // blank line after description
      'Please work on this issue.',
    ])
  })

  it('produces correct line structure without description', () => {
    const lines = buildIssuePromptText({ title: 'T', description: '' }).split('\n')
    expect(lines).toEqual([
      'Issue: T',
      '',                           // blank line after title
      'Please work on this issue.',
    ])
  })

  it('uses custom actionText when provided (i18n support)', () => {
    const result = buildIssuePromptText(
      { title: 'Login bug', description: 'SSO broken.' },
      'Please handle this task.',
    )
    expect(result).toBe('Issue: Login bug\n\nSSO broken.\n\nPlease handle this task.')
  })

  it('uses custom actionText without description', () => {
    const result = buildIssuePromptText({ title: 'T', description: '' }, 'Please handle this task.')
    expect(result).toBe('Issue: T\n\nPlease handle this task.')
  })
})

describe('buildIssuePrompt', () => {
  it('returns plain string when there are no images and no richContent', async () => {
    const result = await buildIssuePrompt({
      title: 'No images',
      description: 'Just text.',
      richContent: null,
      images: [],
    })
    expect(typeof result).toBe('string')
    expect(result).toBe('Issue: No images\n\nJust text.\n\nPlease work on this issue.')
  })

  it('returns block array when images are present', async () => {
    const result = await buildIssuePrompt({
      title: 'With image',
      description: 'Has attachment.',
      richContent: null,
      images: [
        { id: 'img-1', mediaType: 'image/png', data: 'base64data', sizeBytes: 1024 },
      ],
    })
    expect(Array.isArray(result)).toBe(true)
    const blocks = result as Array<Record<string, unknown>>
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({
      type: 'text',
      text: 'Issue: With image\n\nHas attachment.\n\nPlease work on this issue.',
    })
    expect(blocks[1]).toEqual({
      type: 'image',
      mediaType: 'image/png',
      data: 'base64data',
      sizeBytes: 1024,
    })
  })

  it('omits description in content when empty', async () => {
    const result = await buildIssuePrompt({
      title: 'Sparse',
      description: '',
      richContent: null,
      images: [],
    })
    expect(result).toBe('Issue: Sparse\n\nPlease work on this issue.')
  })

  it('falls back to plain text when richContent has no slash mentions', async () => {
    const richContent = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plain rich content' }] }],
    })
    const result = await buildIssuePrompt({
      title: 'Rich but no slash',
      description: 'Plain rich content',
      richContent,
      images: [],
    })
    expect(typeof result).toBe('string')
    expect(result).toContain('Plain rich content')
  })

  it('uses custom actionText', async () => {
    const result = await buildIssuePrompt(
      { title: 'T', description: 'D', richContent: null, images: [] },
      { actionText: 'Please handle this task.' },
    )
    expect(result).toBe('Issue: T\n\nD\n\nPlease handle this task.')
  })
})
