// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests for the list keyboard navigation logic used by SessionsView & IssuesView.
 *
 * We test the pure navigation algorithm (index calculation) rather than the DOM
 * event wiring, following the same pattern as useInboxKeyboard.test.ts.
 */

interface Item {
  id: string
}

function computeNextIndex(
  direction: 'up' | 'down',
  items: Item[],
  selectedId: string | null
): number {
  const currentIdx = selectedId ? items.findIndex((item) => item.id === selectedId) : -1

  if (direction === 'up') {
    return currentIdx <= 0 ? items.length - 1 : currentIdx - 1
  } else {
    return currentIdx >= items.length - 1 ? 0 : currentIdx + 1
  }
}

describe('useListKeyboardNav - navigation logic', () => {
  const items: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

  describe('ArrowDown', () => {
    it('selects the first item when nothing is selected', () => {
      const nextIdx = computeNextIndex('down', items, null)
      expect(items[nextIdx].id).toBe('a')
    })

    it('moves to the next item', () => {
      const nextIdx = computeNextIndex('down', items, 'a')
      expect(items[nextIdx].id).toBe('b')
    })

    it('moves from middle to next', () => {
      const nextIdx = computeNextIndex('down', items, 'b')
      expect(items[nextIdx].id).toBe('c')
    })

    it('wraps from last item to first', () => {
      const nextIdx = computeNextIndex('down', items, 'd')
      expect(items[nextIdx].id).toBe('a')
    })
  })

  describe('ArrowUp', () => {
    it('selects the last item when nothing is selected', () => {
      const nextIdx = computeNextIndex('up', items, null)
      expect(items[nextIdx].id).toBe('d')
    })

    it('moves to the previous item', () => {
      const nextIdx = computeNextIndex('up', items, 'c')
      expect(items[nextIdx].id).toBe('b')
    })

    it('wraps from first item to last', () => {
      const nextIdx = computeNextIndex('up', items, 'a')
      expect(items[nextIdx].id).toBe('d')
    })
  })

  describe('edge cases', () => {
    it('handles single-item list (down stays on same item)', () => {
      const singleItem = [{ id: 'only' }]
      const nextIdx = computeNextIndex('down', singleItem, 'only')
      expect(singleItem[nextIdx].id).toBe('only')
    })

    it('handles single-item list (up stays on same item)', () => {
      const singleItem = [{ id: 'only' }]
      const nextIdx = computeNextIndex('up', singleItem, 'only')
      expect(singleItem[nextIdx].id).toBe('only')
    })

    it('handles selectedId not found in items (treats as no selection)', () => {
      const nextIdx = computeNextIndex('down', items, 'nonexistent')
      expect(items[nextIdx].id).toBe('a')
    })

    it('selects last when pressing up with unknown selectedId', () => {
      const nextIdx = computeNextIndex('up', items, 'nonexistent')
      expect(items[nextIdx].id).toBe('d')
    })
  })
})
