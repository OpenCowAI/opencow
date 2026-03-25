// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { isPathWithinBase, isRealPathWithinBase } from '../../../electron/security/pathBounds'

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

describe('isRealPathWithinBase', () => {
  let tempRoot: string

  afterEach(async () => {
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('returns true for regular file inside base', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'opencow-realpath-bounds-'))
    const baseDir = path.join(tempRoot, 'base')
    const filePath = path.join(baseDir, 'src', 'index.ts')
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, 'export const ok = true', 'utf-8')

    await expect(isRealPathWithinBase(filePath, baseDir)).resolves.toBe(true)
  })

  it('returns false when symlink resolves outside base directory', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'opencow-realpath-bounds-'))
    const baseDir = path.join(tempRoot, 'base')
    const outsideDir = path.join(tempRoot, 'outside')
    await fs.mkdir(baseDir, { recursive: true })
    await fs.mkdir(outsideDir, { recursive: true })
    const outsideFile = path.join(outsideDir, 'secret.txt')
    await fs.writeFile(outsideFile, 'classified', 'utf-8')
    const linkPath = path.join(baseDir, 'link.txt')
    await fs.symlink(outsideFile, linkPath)

    await expect(isRealPathWithinBase(linkPath, baseDir)).resolves.toBe(false)
  })
})
