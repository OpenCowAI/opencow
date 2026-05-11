// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isPathWithinBase } from '../../../electron/security/pathBounds'

describe('isPathWithinBase', () => {
  const base = path.resolve(process.cwd(), 'tmp-workspace', 'project')

  it('returns true for files inside base directory', () => {
    const target = path.resolve(base, 'src', 'index.ts')
    expect(isPathWithinBase(target, base)).toBe(true)
  })

  it('returns true when target equals base directory', () => {
    expect(isPathWithinBase(base, base)).toBe(true)
  })

  it('returns false for traversal outside base directory', () => {
    const target = path.resolve(base, '..', 'outside', 'secret.txt')
    expect(isPathWithinBase(target, base)).toBe(false)
  })

  it('returns false for sibling path with shared prefix', () => {
    const sibling = `${base}-other`
    const target = path.resolve(sibling, 'src', 'index.ts')
    expect(isPathWithinBase(target, base)).toBe(false)
  })
})
