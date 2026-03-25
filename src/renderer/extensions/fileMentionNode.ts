// SPDX-License-Identifier: Apache-2.0

import { Node, mergeAttributes } from '@tiptap/core'

/**
 * Inline atomic node representing a file or directory context reference.
 *
 * Renders as a styled `<span data-file-mention>` that:
 * - Is visually distinct from normal text (chip appearance with file/folder icon)
 * - Cannot be partially edited (atom — backspace removes the whole node)
 * - Exports as `@<name>` via `renderText` so `editor.getText()` is correct
 */
export const FileMentionNode = Node.create({
  name: 'fileMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      /** Relative path within the project (e.g. "src/components/App.tsx") */
      path: { default: '' },
      /** Display name (basename) */
      name: { default: '' },
      /** Whether this is a directory */
      isDirectory: { default: false, rendered: false },
    }
  },

  renderText({ node }) {
    return `@${node.attrs.name}`
  },

  parseHTML() {
    return [{ tag: 'span[data-file-mention]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    // Read from node.attrs because isDirectory has `rendered: false`
    // (excluded from HTMLAttributes to keep DOM clean).
    const isDir = node.attrs.isDirectory === true || node.attrs.isDirectory === 'true'
    return [
      'span',
      mergeAttributes(
        { path: HTMLAttributes.path, name: HTMLAttributes.name },
        {
          'data-file-mention': '',
          class: 'file-mention',
        },
      ),
      // Unicode icons: 📁 for dir, 📄 for file — lightweight, no React needed in ProseMirror
      `${isDir ? '\uD83D\uDCC1' : '\uD83D\uDCC4'} ${HTMLAttributes.name}`,
    ]
  },
})
