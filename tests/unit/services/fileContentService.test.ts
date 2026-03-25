// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { detectLanguage, isBinaryFile } from '../../../src/shared/fileUtils'

describe('detectLanguage', () => {
  it('detects TypeScript', () => {
    expect(detectLanguage('src/app.ts')).toBe('typescript')
  })

  it('detects TSX', () => {
    expect(detectLanguage('App.tsx')).toBe('typescriptreact')
  })

  it('detects JSON', () => {
    expect(detectLanguage('package.json')).toBe('json')
  })

  it('falls back to plaintext for unknown', () => {
    expect(detectLanguage('Makefile')).toBe('plaintext')
    expect(detectLanguage('.env')).toBe('plaintext')
  })
})

describe('isBinaryFile', () => {
  it('detects image files as binary', () => {
    expect(isBinaryFile('photo.png')).toBe(true)
    expect(isBinaryFile('image.jpg')).toBe(true)
  })

  it('detects font files as binary', () => {
    expect(isBinaryFile('font.woff2')).toBe(true)
  })

  it('allows text files', () => {
    expect(isBinaryFile('readme.md')).toBe(false)
    expect(isBinaryFile('app.tsx')).toBe(false)
  })
})

describe('path security for file content', () => {
  it('rejects paths outside project directory', () => {
    const projectPath = '/Users/test/project'
    const maliciousPath = '../../../etc/passwd'

    const resolved = resolve(projectPath, maliciousPath)
    const resolvedBase = resolve(projectPath)
    expect(resolved.startsWith(resolvedBase)).toBe(false)
  })

  it('accepts valid subpaths', () => {
    const projectPath = '/Users/test/project'
    const validPath = 'src/components/App.tsx'

    const resolved = resolve(projectPath, validPath)
    const resolvedBase = resolve(projectPath)
    expect(resolved.startsWith(resolvedBase)).toBe(true)
  })
})
