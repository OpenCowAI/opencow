// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import {
  CONTEXT_FILE_DRAG_MIME,
  encodeContextFileDragPayload,
  decodeContextFileDragPayload,
} from '../../../src/shared/contextFileDnd'

describe('contextFileDnd protocol', () => {
  it('encodes and decodes valid payload', () => {
    const raw = encodeContextFileDragPayload({
      path: 'src/app.ts',
      name: 'app.ts',
      isDirectory: false,
    })

    expect(typeof raw).toBe('string')
    expect(decodeContextFileDragPayload(raw)).toEqual({
      path: 'src/app.ts',
      name: 'app.ts',
      isDirectory: false,
    })
  })

  it('rejects malformed payload', () => {
    expect(decodeContextFileDragPayload('')).toBeNull()
    expect(decodeContextFileDragPayload('{bad json')).toBeNull()
    expect(decodeContextFileDragPayload(JSON.stringify({}))).toBeNull()
    expect(
      decodeContextFileDragPayload(
        JSON.stringify({ path: '', name: 'x', isDirectory: false }),
      ),
    ).toBeNull()
    expect(
      decodeContextFileDragPayload(
        JSON.stringify({ path: 'x', name: '', isDirectory: false }),
      ),
    ).toBeNull()
    expect(
      decodeContextFileDragPayload(
        JSON.stringify({ path: 'x', name: 'x', isDirectory: 'nope' }),
      ),
    ).toBeNull()
  })

  it('exports stable mime identifier', () => {
    expect(CONTEXT_FILE_DRAG_MIME).toBe('application/x-opencow-file')
  })
})
