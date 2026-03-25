// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'

const NAMESPACES = [
  'common',
  'navigation',
  'issues',
  'sessions',
  'inbox',
  'files',
  'schedule',
  'dashboard',
  'settings',
  'onboarding',
] as const

/**
 * Collect all leaf keys from a nested object, flattening with dot-separated paths.
 * e.g. { a: { b: 'x' }, c: 'y' } → ['a.b', 'c']
 */
function collectLeafKeys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return prefix ? [prefix.slice(0, -1)] : []
  }
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    collectLeafKeys(v, `${prefix}${k}.`),
  )
}

/**
 * Normalize English plural suffixes so count_one/count_other → count.
 * Chinese uses a single key without suffixes, so normalization lets us
 * compare key sets across both languages.
 */
function normalizeKey(key: string): string {
  return key.replace(/_(one|other|zero|few|many)$/, '')
}

describe('i18n translation parity', () => {
  for (const ns of NAMESPACES) {
    it(`${ns}: zh-CN and en-US have identical keys (plural-normalized)`, async () => {
      const zh = await import(`../../src/renderer/locales/zh-CN/${ns}.json`)
      const en = await import(`../../src/renderer/locales/en-US/${ns}.json`)

      const zhKeys = [...new Set(collectLeafKeys(zh.default).map(normalizeKey))].sort()
      const enKeys = [...new Set(collectLeafKeys(en.default).map(normalizeKey))].sort()

      expect(enKeys).toEqual(zhKeys)
    })
  }
})
