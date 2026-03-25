// SPDX-License-Identifier: Apache-2.0

import { createRoot, type Root } from 'react-dom/client'
import tippy, { type Instance as TippyInstance } from 'tippy.js'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import { SlashCommandList } from '../components/DetailPanel/SessionPanel/SlashCommandList'
import { groupSlashItems } from '@shared/slashItems'
import type { SlashItem } from '@shared/slashItems'

/**
 * Creates a TipTap Suggestion render function that shows SlashCommandList
 * in a tippy.js popup positioned at the cursor.
 */
export function createSlashCommandRenderer() {
  return () => {
    let root: Root | null = null
    let popup: TippyInstance | null = null
    let container: HTMLDivElement | null = null
    let activeIndex = 0
    let currentItems: SlashItem[] = []
    let selectHandler: ((item: SlashItem) => void) | null = null

    function renderList() {
      if (!root) return
      const groups = groupSlashItems(currentItems, true)

      // Clamp activeIndex to valid range
      const totalItems = groups.reduce((acc, g) => acc + g.items.length, 0)
      if (activeIndex >= totalItems) activeIndex = Math.max(0, totalItems - 1)

      root.render(
        <SlashCommandList
          groups={groups}
          activeIndex={activeIndex}
          onSelect={(item) => selectHandler?.(item)}
        />
      )
    }

    return {
      onStart(props: SuggestionProps<SlashItem, SlashItem>) {
        activeIndex = 0
        currentItems = props.items
        selectHandler = props.command

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

        renderList()
      },

      onUpdate(props: SuggestionProps<SlashItem, SlashItem>) {
        currentItems = props.items
        selectHandler = props.command
        activeIndex = 0

        if (popup && props.clientRect) {
          popup.setProps({
            getReferenceClientRect: props.clientRect as () => DOMRect,
          })
        }

        renderList()
      },

      onKeyDown(props: SuggestionKeyDownProps): boolean {
        const { event } = props

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
          const groups = groupSlashItems(currentItems, true)
          const maxIndex = groups.reduce((acc, g) => acc + g.items.length, 0) - 1
          activeIndex = Math.min(maxIndex, activeIndex + 1)
          renderList()
          return true
        }

        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault()
          const groups = groupSlashItems(currentItems, true)
          const allFlat = groups.flatMap((g) => g.items)
          const selected = allFlat[activeIndex]
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
      },
    }
  }
}
