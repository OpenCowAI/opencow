// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest'
import {
  hasContextFileDrag,
  readContextFileDrag,
  writeContextFileDrag,
} from '../../../src/renderer/lib/contextFileDnd'

describe('renderer contextFileDnd adapter', () => {
  it('writes payload to DataTransfer with copy effect', () => {
    const setData = vi.fn()
    const dt = {
      setData,
      effectAllowed: '',
      types: [],
    } as unknown as DataTransfer

    writeContextFileDrag(dt, {
      path: 'src/a.ts',
      name: 'a.ts',
      isDirectory: false,
    })

    expect(setData).toHaveBeenCalledTimes(1)
    const [mime, raw] = setData.mock.calls[0] as [string, string]
    expect(mime).toBe('application/x-opencow-file')
    expect(JSON.parse(raw)).toEqual({
      path: 'src/a.ts',
      name: 'a.ts',
      isDirectory: false,
    })
    expect((dt as unknown as { effectAllowed: string }).effectAllowed).toBe('copy')
  })

  it('detects and reads payload from DataTransfer', () => {
    const raw = JSON.stringify({
      path: 'src/dir',
      name: 'dir',
      isDirectory: true,
    })
    const dt = {
      types: ['text/plain', 'application/x-opencow-file'],
      getData: vi.fn((mime: string) => (mime === 'application/x-opencow-file' ? raw : '')),
    } as unknown as DataTransfer

    expect(hasContextFileDrag(dt)).toBe(true)
    expect(readContextFileDrag(dt)).toEqual({
      path: 'src/dir',
      name: 'dir',
      isDirectory: true,
    })
  })

  it('returns null for invalid payload', () => {
    const dt = {
      types: ['application/x-opencow-file'],
      getData: vi.fn(() => 'not-json'),
    } as unknown as DataTransfer

    expect(readContextFileDrag(dt)).toBeNull()
  })
})
