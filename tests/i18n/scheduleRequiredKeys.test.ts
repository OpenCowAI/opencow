// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import enUSSchedule from '../../src/renderer/locales/en-US/schedule.json'
import zhCNSchedule from '../../src/renderer/locales/zh-CN/schedule.json'

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (!acc || typeof acc !== 'object' || Array.isArray(acc)) return undefined
    return (acc as Record<string, unknown>)[segment]
  }, obj)
}

describe('schedule i18n required keys', () => {
  const requiredKeys = [
    'action.systemPrompt',
    'action.systemPromptPlaceholder',
    'trigger.cronAdvancedHint',
  ] as const

  for (const [locale, resource] of [
    ['en-US', enUSSchedule as Record<string, unknown>],
    ['zh-CN', zhCNSchedule as Record<string, unknown>],
  ] as const) {
    for (const key of requiredKeys) {
      it(`${locale} contains "${key}"`, () => {
        const value = getByPath(resource, key)
        expect(typeof value).toBe('string')
        expect(String(value).trim().length).toBeGreaterThan(0)
      })
    }
  }
})

