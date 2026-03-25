// SPDX-License-Identifier: Apache-2.0

import type { EventSubscriptionSettings, StatusTransition, SessionStatus } from '@shared/types'
import { allowsTransition, buildEventSubscriptionPolicy } from '../events/eventSubscriptionPolicy'

export interface NotificationPayload {
  title: string
  body: string
  sessionId: string
}

export interface NotificationSender {
  showNotification: (payload: NotificationPayload) => void
}

interface TransitionConfig {
  title: string
  format: (name: string) => string
}

const NOTABLE_TRANSITIONS: Partial<Record<SessionStatus, TransitionConfig>> = {
  completed: {
    title: 'Session Completed',
    format: (name) => `\u201c${name}\u201d has finished`
  },
  error: {
    title: 'Session Error',
    format: (name) => `\u201c${name}\u201d encountered an error`
  },
  waiting: {
    title: 'Attention Required',
    format: (name) => `\u201c${name}\u201d is waiting for input`
  }
}

export class NotificationService {
  private sender: NotificationSender
  private getPreferences: () => EventSubscriptionSettings

  constructor(sender: NotificationSender, getPreferences: () => EventSubscriptionSettings) {
    this.sender = sender
    this.getPreferences = getPreferences
  }

  onTransition(transition: StatusTransition): void {
    const policy = buildEventSubscriptionPolicy(this.getPreferences())
    if (!allowsTransition(policy, transition)) return

    const config = NOTABLE_TRANSITIONS[transition.newStatus]
    if (!config) return

    this.sender.showNotification({
      title: `OpenCow \u2014 ${config.title}`,
      body: config.format(transition.sessionName),
      sessionId: transition.sessionId
    })
  }
}
