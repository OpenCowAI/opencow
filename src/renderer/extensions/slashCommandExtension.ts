// SPDX-License-Identifier: Apache-2.0

import { Extension } from '@tiptap/core'
import { Suggestion } from '@tiptap/suggestion'
import type { SuggestionOptions } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import type { SlashItem } from '@shared/slashItems'
import { buildSlashMentionInsertContent } from '../lib/slashMentionContent'

const slashSuggestionPluginKey = new PluginKey('slashSuggestion')

export interface SlashCommandExtensionOptions {
  suggestion: Omit<SuggestionOptions<SlashItem, SlashItem>, 'editor'>
}

/**
 * TipTap Extension that enables `/` slash command suggestions at any cursor position.
 * Built on @tiptap/suggestion.
 */
export const SlashCommandExtension = Extension.create<SlashCommandExtensionOptions>({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        items: () => [],
        command: ({ editor, range, props: item }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent(buildSlashMentionInsertContent(item))
            .run()
        },
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        pluginKey: slashSuggestionPluginKey,
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ]
  },
})
