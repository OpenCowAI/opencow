// SPDX-License-Identifier: Apache-2.0

import type { RingBuffer } from './types'

const DEFAULT_CAPACITY = 256 * 1024 // 256KB — roughly 4000 lines of 80-column terminal output

/**
 * Fixed-capacity string Ring Buffer.
 *
 * When the Terminal scope switches, the new xterm.js instance needs to replay
 * historical output. This buffer retains the most recent N bytes of PTY output,
 * discarding the oldest data on overflow.
 *
 * Implementation: single string concatenation + truncation (simple and efficient,
 * since PTY output is an append-only string stream).
 */
export function createRingBuffer(capacity = DEFAULT_CAPACITY): RingBuffer {
  let buffer = ''

  return {
    push(data: string): void {
      buffer += data
      if (buffer.length > capacity) {
        let start = buffer.length - capacity
        // Don't start on a low surrogate (would break the pair)
        const code = buffer.charCodeAt(start)
        if (code >= 0xDC00 && code <= 0xDFFF) start++
        buffer = buffer.slice(start)
      }
    },
    drain(): string {
      return buffer
    },
    get size(): number {
      return buffer.length
    },
  }
}
