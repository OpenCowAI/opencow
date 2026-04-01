// SPDX-License-Identifier: Apache-2.0

/**
 * useIncrementalMemo — memoization hook for append-only arrays.
 *
 * Standard `useMemo` recomputes from scratch when the input reference
 * changes.  For append-only data (e.g. session messages), this is
 * wasteful: a new message appended to a 200-item array triggers O(N)
 * recomputation even though only O(1) item changed.
 *
 * This hook exploits the append-only invariant:
 *   - Tracks `processedCount` across renders
 *   - On each input change, only processes items[processedCount..N]
 *   - Automatically resets when:
 *     (a) The array shrinks (defensive — shouldn't happen in practice)
 *     (b) The `resetKey` changes (e.g. sessionId switch)
 *
 * The `processor` callback receives only the NEW items and the current
 * accumulated result, returning the next result.  It must return the
 * SAME reference when no meaningful change occurred (enables React.memo
 * / Context skip optimizations downstream).
 *
 * @example
 * ```ts
 * // Incremental tool lifecycle map — O(delta) per structural change
 * const toolMap = useIncrementalMemo(
 *   messages,
 *   sessionId,
 *   (newMsgs, prevMap) => {
 *     let nextMap = prevMap
 *     for (const msg of newMsgs) {
 *       if (msg.role === 'system') continue
 *       for (const block of msg.content) {
 *         if (block.type === 'tool_use') {
 *           if (nextMap === prevMap) nextMap = new Map(prevMap) // copy-on-write
 *           nextMap.set(block.id, { name: block.name })
 *         }
 *       }
 *     }
 *     return nextMap
 *   },
 *   () => new Map(),
 * )
 * ```
 */

import { useRef, useMemo } from 'react'

/**
 * Memoize a derived value over an append-only array with O(delta) cost.
 *
 * @param items     — The append-only input array (e.g. session messages).
 * @param resetKey  — When this value changes, the cache is fully reset
 *                    (e.g. sessionId for session-switch safety).
 * @param processor — Called with `(newItems, previousResult, allItems)` →
 *                    next result.  Most processors only need `newItems` +
 *                    `previousResult`.  `allItems` is provided for cases
 *                    where incremental processing is infeasible and a full
 *                    rebuild over all items is required (e.g. artifact
 *                    extraction with per-file accumulation).
 *                    Must return `previousResult` reference when unchanged.
 * @param init      — Factory for the initial accumulated value. Called on
 *                    first render and after each reset.
 */
export function useIncrementalMemo<TItem, TResult>(
  items: readonly TItem[],
  resetKey: string,
  processor: (newItems: readonly TItem[], prev: TResult, allItems: readonly TItem[]) => TResult,
  init: () => TResult,
): TResult {
  const cacheRef = useRef<{
    result: TResult
    processedCount: number
    resetKey: string
    lastItems: readonly TItem[]
  } | null>(null)

  return useMemo(() => {
    let cache = cacheRef.current

    // Initialize or reset on key change / array shrink
    if (
      !cache ||
      cache.resetKey !== resetKey ||
      items.length < cache.processedCount
    ) {
      const initial = init()
      cache = { result: initial, processedCount: 0, resetKey, lastItems: items }
      cacheRef.current = cache
    }

    // Same logical length: append-only delta is empty, but callers can still
    // replace existing items in-place (e.g. assistant message finalization:
    // isStreaming=true -> false on manual stop). In that case, incremental
    // append processing must fall back to a full rebuild.
    if (items.length === cache.processedCount) {
      const prevItems = cache.lastItems
      let hasInPlaceUpdate = false
      if (prevItems !== items) {
        for (let i = 0; i < items.length; i++) {
          if (prevItems[i] !== items[i]) {
            hasInPlaceUpdate = true
            break
          }
        }
      }

      if (!hasInPlaceUpdate) {
        cache.lastItems = items
        return cache.result
      }

      const rebuilt = init()
      cache.result = processor(items, rebuilt, items)
      cache.processedCount = items.length
      cache.lastItems = items
      return cache.result
    }

    // Process only the delta
    const delta = items.slice(cache.processedCount)
    cache.result = processor(delta, cache.result, items)
    cache.processedCount = items.length
    cache.lastItems = items
    return cache.result
  }, [items, resetKey, processor, init])
}
