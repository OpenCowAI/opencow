// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef } from 'react'
import { useEditor } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import type { Editor, Extensions, JSONContent } from '@tiptap/core'
import type { SuggestionOptions } from '@tiptap/suggestion'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import HardBreak from '@tiptap/extension-hard-break'
import History from '@tiptap/extension-history'
import Placeholder from '@tiptap/extension-placeholder'
import { SlashCommandExtension } from '../extensions/slashCommandExtension'
import { SlashMentionNode } from '../extensions/slashMentionNode'
import { FileMentionExtension } from '../extensions/fileMentionExtension'
import { FileMentionNode } from '../extensions/fileMentionNode'
import type { SlashItem } from '@shared/slashItems'
import type { FileEntry } from '@shared/types'

/* ------------------------------------------------------------------ */
/*  CtrlJNewline: Ctrl+J inserts a newline (new paragraph)             */
/*                                                                     */
/*  Always enabled so every editor has a consistent Ctrl+J shortcut    */
/*  for inserting line breaks — regardless of whether Enter is         */
/*  repurposed for submit.                                             */
/* ------------------------------------------------------------------ */

const CtrlJNewline = Extension.create({
  name: 'ctrlJNewline',

  addKeyboardShortcuts() {
    return {
      'Control-j': () => {
        // Use splitBlock (new paragraph) instead of setHardBreak (<br>).
        // extractEditorSegments joins paragraphs with '\n' but silently
        // drops hardBreak nodes because their textContent is empty.
        this.editor.commands.splitBlock()
        return true
      }
    }
  }
})

/* ------------------------------------------------------------------ */
/*  SubmitOnEnter: intercept Enter to trigger submit callback          */
/*                                                                     */
/*  When enabled, Enter is repurposed for submit; users rely on        */
/*  Ctrl+J (provided by CtrlJNewline above) for inserting newlines.    */
/*                                                                     */
/*  Only added when onEnter is provided. Without it, Enter retains     */
/*  its default TipTap behaviour (create a new paragraph).             */
/* ------------------------------------------------------------------ */

const SubmitOnEnter = Extension.create<{ onEnter: () => void }>({
  name: 'submitOnEnter',

  addOptions() {
    return { onEnter: () => {} }
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        this.options.onEnter()
        return true // prevent default paragraph creation
      }
    }
  }
})

/* ------------------------------------------------------------------ */
/*  Hook options                                                       */
/* ------------------------------------------------------------------ */

export interface UsePlainTextEditorOptions {
  /** Placeholder text shown when the editor is empty */
  placeholder?: string
  /** Whether the editor is editable (defaults to true) */
  editable?: boolean
  /** ARIA label for the contenteditable element */
  ariaLabel?: string
  /**
   * Initial document content (TipTap JSON).
   * Applied once when the editor is created; subsequent changes are ignored.
   * Used by queue item editing to pre-populate the editor with existing content.
   */
  initialContent?: JSONContent
  /** Called when the user presses Enter (without Shift) */
  onEnter?: () => void
  /** Called when files (images, PDFs, etc.) are pasted from the clipboard */
  onPasteFiles?: (files: File[]) => void
  /** Slash command suggestion config. Pass to enable '/' command popup at any cursor position. */
  slashSuggestion?: Omit<SuggestionOptions<SlashItem, SlashItem>, 'editor'>
  /** File mention suggestion config. Pass to enable '@' file mention popup at any cursor position. */
  fileSuggestion?: Omit<SuggestionOptions<FileEntry, FileEntry>, 'editor'>
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function usePlainTextEditor(
  options: UsePlainTextEditorOptions
): Editor | null {
  const {
    placeholder = '',
    editable = true,
    ariaLabel = '',
    initialContent,
    onEnter,
    onPasteFiles,
    slashSuggestion,
    fileSuggestion,
  } = options

  // Stable refs to avoid stale closures inside TipTap extensions
  const onEnterRef = useRef(onEnter)
  const onPasteFilesRef = useRef(onPasteFiles)

  useEffect(() => {
    onEnterRef.current = onEnter
  }, [onEnter])

  useEffect(() => {
    onPasteFilesRef.current = onPasteFiles
  }, [onPasteFiles])

  // Build extensions array (typed as Extensions to allow heterogeneous push)
  const extensions: Extensions = [
    Document,
    Paragraph,
    Text,
    HardBreak, // Shift+Enter inserts <br> by default
    History,
    SlashMentionNode,
    FileMentionNode,
    CtrlJNewline, // Ctrl+J → newline in every editor
    Placeholder.configure({ placeholder }),
  ]

  // Only add SubmitOnEnter when a submit callback is provided.
  // Without it, Enter retains its default TipTap behaviour (new paragraph).
  if (onEnter) {
    extensions.push(
      SubmitOnEnter.configure({
        onEnter: () => onEnterRef.current?.()
      })
    )
  }

  // Conditionally add slash command extension
  if (slashSuggestion) {
    extensions.push(
      SlashCommandExtension.configure({
        suggestion: slashSuggestion
      })
    )
  }

  // Conditionally add file mention extension
  if (fileSuggestion) {
    extensions.push(
      FileMentionExtension.configure({
        suggestion: fileSuggestion
      })
    )
  }

  const editor = useEditor({
    extensions,
    editable,
    content: initialContent,
    editorProps: {
      attributes: {
        'aria-label': ariaLabel,
        role: 'textbox',
        'aria-multiline': 'true',
        spellcheck: 'false',
        autocomplete: 'off',
        class: 'plain-text-editor'
      },

      // Intercept paste to extract file attachments (images, PDFs);
      // let plain-text paste through to TipTap's default handler.
      handlePaste: (_view, event) => {
        const items = Array.from(event.clipboardData?.items ?? [])
        const fileItems = items.filter(
          (item) =>
            item.kind === 'file' &&
            (item.type.startsWith('image/') || item.type === 'application/pdf')
        )
        if (fileItems.length === 0) return false // default text paste

        event.preventDefault()
        const files = fileItems
          .map((item) => item.getAsFile())
          .filter((f): f is File => f !== null)
        if (files.length > 0) {
          onPasteFilesRef.current?.(files)
        }
        return true
      }
    }
  })

  // Sync editable state reactively (without rebuilding the editor)
  useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable)
    }
  }, [editor, editable])

  return editor
}
