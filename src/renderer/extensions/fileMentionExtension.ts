// SPDX-License-Identifier: Apache-2.0

import { Extension } from '@tiptap/core'
import { Suggestion } from '@tiptap/suggestion'
import type { SuggestionOptions } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import type { FileEntry } from '@shared/types'

const fileMentionPluginKey = new PluginKey('fileMentionSuggestion')

export interface FileMentionExtensionOptions {
  suggestion: Omit<SuggestionOptions<FileEntry, FileEntry>, 'editor'>
}

/**
 * TipTap Extension that enables `@` file mention suggestions at any cursor position.
 * Built on @tiptap/suggestion — mirrors the SlashCommandExtension pattern.
 */
export const FileMentionExtension = Extension.create<FileMentionExtensionOptions>({
  name: 'fileMentionSuggestion',

  addOptions() {
    return {
      suggestion: {
        char: '@',
        allowSpaces: false,
        startOfLine: false,
        items: () => [],
        command: ({ editor, range, props: entry }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              {
                type: 'fileMention',
                attrs: {
                  path: entry.path,
                  name: entry.name,
                  isDirectory: entry.isDirectory,
                },
              },
              { type: 'text', text: ' ' },
            ])
            .run()
        },
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<FileEntry, FileEntry>({
        pluginKey: fileMentionPluginKey,
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ]
  },
})
