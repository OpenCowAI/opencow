// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotificationService } from '../../../electron/services/notificationService'
import type { EventSubscriptionSettings, StatusTransition, SessionStatus } from '../../../src/shared/types'

function makeTransition(
  newStatus: SessionStatus,
  previousStatus: SessionStatus = 'active',
  name = 'Test session'
): StatusTransition {
  return {
    sessionId: 'sess-1',
    sessionName: name,
    previousStatus,
    newStatus,
    timestamp: Date.now()
  }
}

const DEFAULT_PREFS: EventSubscriptionSettings = {
  enabled: true,
  onError: true,
  onComplete: true,
  onStatusChange: true
}

describe('NotificationService', () => {
  let service: NotificationService
  let mockShow: ReturnType<typeof vi.fn>
  let prefs: EventSubscriptionSettings

  beforeEach(() => {
    mockShow = vi.fn()
    prefs = { ...DEFAULT_PREFS }
    service = new NotificationService({ showNotification: mockShow }, () => prefs)
  })

  it('does not notify when enabled is false', () => {
    prefs.enabled = false
    service.onTransition(makeTransition('completed'))
    expect(mockShow).not.toHaveBeenCalled()
  })

  it('notifies when enabled is true', () => {
    service.onTransition(makeTransition('completed'))
    expect(mockShow).toHaveBeenCalledTimes(1)
  })

  it('notifies on completed transition', () => {
    service.onTransition(makeTransition('completed'))
    expect(mockShow).toHaveBeenCalledWith({
      title: 'OpenCow — Session Completed',
      body: '\u201cTest session\u201d has finished',
      sessionId: 'sess-1'
    })
  })

  it('notifies on error transition', () => {
    service.onTransition(makeTransition('error'))
    expect(mockShow).toHaveBeenCalledWith({
      title: 'OpenCow — Session Error',
      body: '\u201cTest session\u201d encountered an error',
      sessionId: 'sess-1'
    })
  })

  it('notifies on waiting transition', () => {
    service.onTransition(makeTransition('waiting'))
    expect(mockShow).toHaveBeenCalledWith({
      title: 'OpenCow — Attention Required',
      body: '\u201cTest session\u201d is waiting for input',
      sessionId: 'sess-1'
    })
  })

  it('does NOT notify on active transition', () => {
    service.onTransition(makeTransition('active', 'waiting'))
    expect(mockShow).not.toHaveBeenCalled()
  })

  it('respects onComplete preference', () => {
    prefs.onComplete = false
    service.onTransition(makeTransition('completed'))
    expect(mockShow).not.toHaveBeenCalled()
  })

  it('respects onError preference', () => {
    prefs.onError = false
    service.onTransition(makeTransition('error'))
    expect(mockShow).not.toHaveBeenCalled()
  })

  it('respects onStatusChange preference for waiting', () => {
    prefs.onStatusChange = false
    service.onTransition(makeTransition('waiting'))
    expect(mockShow).not.toHaveBeenCalled()
  })
})
