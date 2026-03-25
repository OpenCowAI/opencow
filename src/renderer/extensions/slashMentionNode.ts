// SPDX-License-Identifier: Apache-2.0

import { Node, mergeAttributes } from '@tiptap/core'

/**
 * Inline atomic node representing a selected slash command.
 *
 * Renders as a styled `<span data-slash-mention>` that:
 * - Is visually distinct from normal text (chip/tag appearance)
 * - Cannot be partially edited (atom — backspace removes the whole node)
 * - Exports as `/<label|name>` while preserving canonical `name` for execution
 */
export const SlashMentionNode = Node.create({
  name: 'slashMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      mentionId: { default: undefined, rendered: false },
      name: { default: '' },
      category: { default: 'builtin', rendered: false },
      sourcePath: { default: undefined, rendered: false },
      label: { default: undefined, rendered: false },
      executionContract: { default: undefined, rendered: false },
    }
  },

  renderText({ node }) {
    const label = typeof node.attrs.label === 'string' ? node.attrs.label.trim() : ''
    const displayName = label || node.attrs.name
    return `/${displayName}`
  },

  parseHTML() {
    return [{ tag: 'span[data-slash-mention]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = typeof node.attrs.label === 'string' ? node.attrs.label.trim() : ''
    const displayName = label || HTMLAttributes.name
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-slash-mention': '',
        class: 'slash-mention',
      }),
      `/${displayName}`,
    ]
  },
})
