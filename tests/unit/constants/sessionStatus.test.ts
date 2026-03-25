// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import {
  SESSION_STATUS_THEME,
  SESSION_STATUSES
} from '../../../src/renderer/constants/sessionStatus'
import type { SessionStatus } from '../../../src/shared/types'

describe('SESSION_STATUS_THEME', () => {
  it('defines a theme for every SessionStatus value', () => {
    const expectedStatuses: SessionStatus[] = ['active', 'waiting', 'completed', 'error']
    for (const status of expectedStatuses) {
      expect(SESSION_STATUS_THEME[status]).toBeDefined()
      expect(SESSION_STATUS_THEME[status].label).toBeTypeOf('string')
      expect(SESSION_STATUS_THEME[status].dotColor).toBeTypeOf('string')
      expect(SESSION_STATUS_THEME[status].badgeVariant).toBeTypeOf('string')
    }
  })

  it('only active status has dotAnimation defined', () => {
    expect(SESSION_STATUS_THEME.active.dotAnimation).toBeTypeOf('string')
    expect(SESSION_STATUS_THEME.waiting.dotAnimation).toBeUndefined()
    expect(SESSION_STATUS_THEME.completed.dotAnimation).toBeUndefined()
    expect(SESSION_STATUS_THEME.error.dotAnimation).toBeUndefined()
  })
})

describe('SESSION_STATUS_THEME progressColor', () => {
  it.each<SessionStatus>(['active', 'waiting', 'completed', 'error'])(
    '%s has a progressColor field',
    (status) => {
      expect(SESSION_STATUS_THEME[status].progressColor).toBeDefined()
      expect(SESSION_STATUS_THEME[status].progressColor).toMatch(/^bg-/)
    }
  )
})

describe('SESSION_STATUSES', () => {
  it('is an ordered array of all statuses', () => {
    expect(SESSION_STATUSES).toEqual(['active', 'waiting', 'completed', 'error'])
  })
})
