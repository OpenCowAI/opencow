// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { parseFileSearchQuery } from '../../../src/renderer/lib/fileSearchQuery'

describe('parseFileSearchQuery', () => {
  it('parses plain query without line suffix', () => {
    expect(parseFileSearchQuery('src/app.ts')).toEqual({
      searchText: 'src/app.ts',
      line: null,
    })
  })

  it('parses trailing :line suffix', () => {
    expect(parseFileSearchQuery('src/app.ts:128')).toEqual({
      searchText: 'src/app.ts',
      line: 128,
    })
  })

  it('keeps original text when line suffix is invalid', () => {
    expect(parseFileSearchQuery('src/app.ts:0')).toEqual({
      searchText: 'src/app.ts:0',
      line: null,
    })
    expect(parseFileSearchQuery('src/app.ts:abc')).toEqual({
      searchText: 'src/app.ts:abc',
      line: null,
    })
  })

  it('does not parse when prefix is empty', () => {
    expect(parseFileSearchQuery(':20')).toEqual({
      searchText: ':20',
      line: null,
    })
  })
})
