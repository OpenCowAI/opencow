// SPDX-License-Identifier: Apache-2.0

import { createRoot, type Root } from 'react-dom/client'
import tippy, { type Instance as TippyInstance } from 'tippy.js'
import type { Editor, Range } from '@tiptap/core'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import { FileMentionList } from '../components/DetailPanel/SessionPanel/FileMentionList'
import type { FileEntry } from '@shared/types'

/**
 * Creates a TipTap Suggestion render function that shows FileMentionList
 * in a tippy.js popup positioned at the cursor.
 *
 * Features:
 * - Tab on a directory → navigates into it (replaces query with dirpath/)
 * - Tab on a file → selects it (same as Enter)
 * - Enter → always selects the active item
 *
 * @param onActivate - called when the popup first opens (to trigger file loading)
 */
export function createFileMentionRenderer(onActivate: () => void) {
  return () => {
    let root: Root | null = null
    let popup: TippyInstance | null = null
    let container: HTMLDivElement | null = null
    let activeIndex = 0
    let currentItems: FileEntry[] = []
    let selectHandler: ((item: FileEntry) => void) | null = null
    let currentEditor: Editor | null = null
    /** Tracked suggestion range — updated by onStart/onUpdate, used for navigateIntoDir */
    let currentRange: Range | null = null

    function renderList() {
      if (!root) return

      // Clamp activeIndex to valid range
      if (activeIndex >= currentItems.length) activeIndex = Math.max(0, currentItems.length - 1)

      root.render(
        <FileMentionList
          items={currentItems}
          activeIndex={activeIndex}
          onSelect={(item) => {
            if (item.isDirectory) {
              navigateIntoDir(item)
            } else {
              selectHandler?.(item)
            }
          }}
          onTabIntoDir={(item) => navigateIntoDir(item)}
        />
      )
    }

    /**
     * Navigate into a directory: replace the current query text with `dirpath/`
     * so the suggestion re-fires with the directory contents.
     *
     * Uses the tracked `currentRange` from TipTap suggestion (range.from = '@' position,
     * range.to = end of query). This is robust — no manual scanning needed.
     */
    function navigateIntoDir(dir: FileEntry) {
      if (!currentEditor || !currentRange) return

      const newQuery = dir.path + '/'

      // range.from = position of '@' trigger, so range.from + 1 = start of query text
      const { state } = currentEditor
      const tr = state.tr.insertText(newQuery, currentRange.from + 1, currentRange.to)
      currentEditor.view.dispatch(tr)
    }

    return {
      onStart(props: SuggestionProps<FileEntry, FileEntry>) {
        activeIndex = 0
        currentItems = props.items
        selectHandler = props.command
        currentEditor = props.editor
        currentRange = props.range

        container = document.createElement('div')
        root = createRoot(container)

        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

        popup = tippy(props.editor.view.dom, {
          getReferenceClientRect: props.clientRect as (() => DOMRect) | undefined,
          appendTo: () => document.body,
          content: container,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'top-start',
          maxWidth: 400,
          animation: reducedMotion ? false : 'shift-away',
        })

        onActivate()
        renderList()
      },

      onUpdate(props: SuggestionProps<FileEntry, FileEntry>) {
        currentItems = props.items
        selectHandler = props.command
        currentEditor = props.editor
        currentRange = props.range
        activeIndex = 0

        if (popup && props.clientRect) {
          popup.setProps({
            getReferenceClientRect: props.clientRect as () => DOMRect,
          })
        }

        renderList()
      },

      onKeyDown(props: SuggestionKeyDownProps): boolean {
        const { event, range } = props

        // Keep range in sync from keyDown events too (most up-to-date)
        currentRange = range

        const isUp = event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')
        const isDown = event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')

        if (isUp) {
          event.preventDefault()
          activeIndex = Math.max(0, activeIndex - 1)
          renderList()
          return true
        }

        if (isDown) {
          event.preventDefault()
          activeIndex = Math.min(currentItems.length - 1, activeIndex + 1)
          renderList()
          return true
        }

        // Tab: navigate into directory or select file
        if (event.key === 'Tab') {
          event.preventDefault()
          const selected = currentItems[activeIndex]
          if (selected?.isDirectory) {
            navigateIntoDir(selected)
          } else if (selected) {
            selectHandler?.(selected)
          }
          return true
        }

        // Enter: always select (insert as mention)
        if (event.key === 'Enter') {
          event.preventDefault()
          const selected = currentItems[activeIndex]
          if (selected) {
            selectHandler?.(selected)
          }
          return true
        }

        if (event.key === 'Escape') {
          popup?.hide()
          return true
        }

        return false
      },

      onExit() {
        popup?.destroy()
        root?.unmount()
        popup = null
        root = null
        container = null
        selectHandler = null
        currentEditor = null
        currentRange = null
      },
    }
  }
}
