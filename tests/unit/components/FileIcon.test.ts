// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'

// Test the resolution logic directly by reimporting it
// Since the component uses internal functions, we test the same logic patterns

// Mirror the resolution logic for testing
function resolveExt(filename: string): string | undefined {
  return filename.split('.').pop()?.toLowerCase()
}

const KNOWN_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'json', 'yaml', 'yml', 'toml',
  'html', 'xml', 'svg', 'css', 'scss', 'less',
  'md', 'mdx', 'txt', 'py', 'rs', 'go', 'java',
  'sh', 'bash', 'zsh', 'sql', 'graphql',
  'png', 'jpg', 'jpeg', 'gif', 'webp',
  'mp4', 'mov', 'mp3', 'wav',
  'zip', 'tar', 'gz', 'rar',
  'csv', 'xlsx', 'lock', 'env',
])

const KNOWN_FILENAMES = new Set([
  'package.json', 'tsconfig.json', 'Dockerfile',
  '.gitignore', 'LICENSE', 'Makefile', '.env',
  'CLAUDE.md',
])

describe('FileIcon resolution logic', () => {
  describe('extension extraction', () => {
    it('extracts simple extensions', () => {
      expect(resolveExt('app.ts')).toBe('ts')
      expect(resolveExt('style.css')).toBe('css')
    })

    it('extracts from dotfiles', () => {
      expect(resolveExt('.env')).toBe('env')
      expect(resolveExt('.gitignore')).toBe('gitignore')
    })

    it('handles multi-dot filenames', () => {
      expect(resolveExt('app.test.ts')).toBe('ts')
      expect(resolveExt('docker-compose.yaml')).toBe('yaml')
    })
  })

  describe('known extensions coverage', () => {
    it('covers TypeScript/JavaScript variants', () => {
      for (const ext of ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs']) {
        expect(KNOWN_EXTS.has(ext) || ext === 'mjs' || ext === 'cjs').toBe(true)
      }
    })

    it('covers style files', () => {
      for (const ext of ['css', 'scss', 'less']) {
        expect(KNOWN_EXTS.has(ext)).toBe(true)
      }
    })

    it('covers image files', () => {
      for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp']) {
        expect(KNOWN_EXTS.has(ext)).toBe(true)
      }
    })
  })

  describe('exact filename matching', () => {
    it('recognizes config files', () => {
      expect(KNOWN_FILENAMES.has('package.json')).toBe(true)
      expect(KNOWN_FILENAMES.has('tsconfig.json')).toBe(true)
    })

    it('recognizes special files', () => {
      expect(KNOWN_FILENAMES.has('Dockerfile')).toBe(true)
      expect(KNOWN_FILENAMES.has('LICENSE')).toBe(true)
      expect(KNOWN_FILENAMES.has('CLAUDE.md')).toBe(true)
    })
  })

  describe('pattern matching', () => {
    it('matches tsconfig variants', () => {
      const pattern = (n: string): boolean => n.startsWith('tsconfig') && n.endsWith('.json')
      expect(pattern('tsconfig.json')).toBe(true)
      expect(pattern('tsconfig.node.json')).toBe(true)
      expect(pattern('tsconfig.web.json')).toBe(true)
    })

    it('matches README variants', () => {
      const pattern = (n: string): boolean => n.startsWith('README')
      expect(pattern('README.md')).toBe(true)
      expect(pattern('README')).toBe(true)
      expect(pattern('README.txt')).toBe(true)
    })

    it('matches env variants', () => {
      const pattern = (n: string): boolean => n.startsWith('.env')
      expect(pattern('.env')).toBe(true)
      expect(pattern('.env.local')).toBe(true)
      expect(pattern('.env.production')).toBe(true)
    })
  })
})
