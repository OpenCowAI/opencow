// SPDX-License-Identifier: Apache-2.0

/**
 * Safe JSONL / line-oriented file reading with guaranteed FD cleanup.
 *
 * This module is the ONLY approved way to read line-oriented files
 * (JSONL session files, etc.) in OpenCow. All other file-reading code
 * MUST use these functions.
 *
 * Two modes:
 *
 *  readAllLines(filePath)
 *    Reads the entire file into memory via readFile().
 *    Zero FD-leak risk — no stream to clean up.
 *    Use for: parseSessionContent(), searchSessionFile().
 *
 *  readLinesFromStream(filePath, options)
 *    Reads lines via a ReadStream, with explicit stream.destroy() in
 *    a finally block. The FD is released immediately when the function
 *    returns — not deferred to GC.
 *    Use for: parseSessionMetadata() (maxLines), scanFromOffset() (start offset).
 *
 * Why this matters:
 *   readline.close()   → closes the readline interface only
 *   stream.destroy()   → releases the underlying file descriptor (synchronous)
 *
 *   Without stream.destroy(), breaking out of a for-await-of on readline
 *   leaves the ReadStream's FD open until GC collects it. On macOS with a
 *   default FD soft limit of 256, this quickly leads to spawn EBADF.
 */

import { readFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

/**
 * Read ALL lines from a file. Uses readFile() — zero FD leak risk.
 *
 * Suitable for full-file reads where all content is needed.
 * NOT suitable for large files where only a few lines are needed.
 */
export async function readAllLines(filePath: string): Promise<string[]> {
  const content = await readFile(filePath, 'utf-8')
  return content.split('\n').filter(Boolean)
}

export interface StreamReadOptions {
  /** Byte offset to start reading from (default: 0). */
  start?: number
  /** Maximum number of lines to return. 0 = unlimited (default: 0). */
  maxLines?: number
}

/**
 * Read lines from a file using a stream, with GUARANTEED FD cleanup.
 *
 * Uses try/finally with explicit stream.destroy() to release the file
 * descriptor immediately, regardless of how the read terminates
 * (natural completion, early break via maxLines, or thrown error).
 */
export async function readLinesFromStream(
  filePath: string,
  options?: StreamReadOptions
): Promise<string[]> {
  const { start = 0, maxLines = 0 } = options ?? {}

  const stream = createReadStream(filePath, { encoding: 'utf-8', start })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  const lines: string[] = []

  try {
    for await (const line of rl) {
      if (line) lines.push(line)
      if (maxLines > 0 && lines.length >= maxLines) break
    }
  } finally {
    rl.close()
    stream.destroy()
  }

  return lines
}
