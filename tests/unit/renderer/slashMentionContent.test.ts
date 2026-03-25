// SPDX-License-Identifier: Apache-2.0

// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildSlashMentionAttrs, buildSlashMentionInsertContent } from '../../../src/renderer/lib/slashMentionContent'
import type { SlashItem } from '../../../src/shared/slashItems'

function makeItem(overrides: Partial<SlashItem>): SlashItem {
  return {
    id: 'skill:global:test',
    name: 'test-skill',
    description: 'Test skill',
    category: 'skill',
    order: 1,
    ...overrides,
  }
}

describe('buildSlashMentionAttrs', () => {
  it('keeps canonical execution fields for all slash items', () => {
    const item = makeItem({
      name: 'evose:x_analyst_abc123',
      category: 'skill',
      sourcePath: 'evose://skill/app-x-analyst',
      presentation: {
        variant: 'app',
        title: 'X Analyst',
      },
    })

    expect(buildSlashMentionAttrs(item)).toEqual({
      name: 'evose:x_analyst_abc123',
      category: 'skill',
      sourcePath: 'evose://skill/app-x-analyst',
      label: 'X Analyst',
    })
  })

  it('does not emit label when no presentation title exists', () => {
    const item = makeItem({
      name: 'compact',
      category: 'builtin',
      sourcePath: undefined,
    })

    expect(buildSlashMentionAttrs(item)).toEqual({
      name: 'compact',
      category: 'builtin',
      sourcePath: undefined,
    })
  })
})

describe('buildSlashMentionInsertContent', () => {
  it('builds slashMention node + separator space payload', () => {
    const item = makeItem({
      name: 'evose:x_analyst_abc123',
      category: 'skill',
      sourcePath: 'evose://skill/app-x-analyst',
      presentation: {
        variant: 'app',
        title: 'X Analyst',
      },
    })

    expect(buildSlashMentionInsertContent(item)).toEqual([
      {
        type: 'slashMention',
        attrs: {
          name: 'evose:x_analyst_abc123',
          category: 'skill',
          sourcePath: 'evose://skill/app-x-analyst',
          label: 'X Analyst',
        },
      },
      { type: 'text', text: ' ' },
    ])
  })
})

