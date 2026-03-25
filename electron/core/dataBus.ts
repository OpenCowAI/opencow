// SPDX-License-Identifier: Apache-2.0

import type { AppStateMain, DataBusEvent, HookEvent, StatusTransition } from '@shared/types'
import { mapHookEventType } from '../hooks/hookEventMap'

type BroadcastListener = (event: DataBusEvent) => void
type StateChangeListener = (prev: AppStateMain, next: AppStateMain, event: DataBusEvent) => void
type StatusTransitionListener = (transition: StatusTransition) => void

const MAX_HOOK_EVENTS = 1000

function createEmptyState(): AppStateMain {
  return {
    projects: [],
    sessions: [],
    tasks: new Map(),
    stats: null,
    hookEvents: [],
    onboarding: { completed: false, hooksInstalled: false },
    inboxMessages: [],
    inboxUnreadCount: 0,
    settings: null,
    providerStatus: null
  }
}

function snapshotState(state: AppStateMain): AppStateMain {
  return {
    projects: [...state.projects],
    sessions: state.sessions.map((s) => ({ ...s, taskSummary: { ...s.taskSummary } })),
    tasks: new Map(Array.from(state.tasks.entries()).map(([k, v]) => [k, [...v]])),
    stats: state.stats ? { ...state.stats } : null,
    hookEvents: [...state.hookEvents],
    onboarding: { ...state.onboarding },
    inboxMessages: [...state.inboxMessages],
    inboxUnreadCount: state.inboxUnreadCount,
    settings: state.settings
      ? {
          ...state.settings,
          proxy: { ...state.settings.proxy },
          command: { ...state.settings.command },
          eventSubscriptions: { ...state.settings.eventSubscriptions }
        }
      : null,
    providerStatus: state.providerStatus ? { ...state.providerStatus } : null
  }
}

export class DataBus {
  private state: AppStateMain
  private broadcastListeners: Set<BroadcastListener> = new Set()
  private stateChangeListeners: Set<StateChangeListener> = new Set()
  private statusTransitionListeners: Set<StatusTransitionListener> = new Set()

  constructor() {
    this.state = createEmptyState()
  }

  dispatch(event: DataBusEvent): void {
    const prevState = snapshotState(this.state)

    this.applyEvent(event)

    const nextState = snapshotState(this.state)

    for (const listener of this.broadcastListeners) {
      listener(event)
    }

    for (const listener of this.stateChangeListeners) {
      listener(prevState, nextState, event)
    }
  }

  getState(): AppStateMain {
    return snapshotState(this.state)
  }

  onBroadcast(listener: BroadcastListener): () => void {
    this.broadcastListeners.add(listener)
    return () => {
      this.broadcastListeners.delete(listener)
    }
  }

  onStateChange(listener: StateChangeListener): () => void {
    this.stateChangeListeners.add(listener)
    return () => {
      this.stateChangeListeners.delete(listener)
    }
  }

  onStatusTransition(listener: StatusTransitionListener): () => void {
    this.statusTransitionListeners.add(listener)
    return () => {
      this.statusTransitionListeners.delete(listener)
    }
  }

  private applyEvent(event: DataBusEvent): void {
    switch (event.type) {
      case 'sessions:updated':
        this.state.projects = event.payload.projects
        this.state.sessions = event.payload.sessions
        break

      case 'sessions:detail':
        // Currently a forwarding event for the renderer; no main state mutation needed
        break

      case 'tasks:updated': {
        const { sessionId, tasks } = event.payload
        this.state.tasks.set(sessionId, tasks)

        // Update taskSummary on the matching session
        const session = this.state.sessions.find((s) => s.id === sessionId)
        if (session) {
          session.taskSummary = {
            total: tasks.length,
            completed: tasks.filter((t) => t.status === 'completed').length,
            inProgress: tasks.filter((t) => t.status === 'in_progress').length,
            pending: tasks.filter((t) => t.status === 'pending').length
          }
        }
        break
      }

      case 'stats:updated':
        this.state.stats = event.payload
        break

      case 'hooks:event':
        this.applyHookToSession(event.payload)
        if (event.payload.eventType !== null) {
          this.state.hookEvents.push(event.payload)
          if (this.state.hookEvents.length > MAX_HOOK_EVENTS) {
            this.state.hookEvents = this.state.hookEvents.slice(-MAX_HOOK_EVENTS)
          }
        }
        break

      case 'onboarding:status':
        this.state.onboarding = event.payload
        break

      case 'inbox:updated':
        this.state.inboxMessages = event.payload.messages
        this.state.inboxUnreadCount = event.payload.unreadCount
        break

      case 'settings:updated':
        this.state.settings = event.payload
        break

      case 'provider:status':
        this.state.providerStatus = event.payload
        break

      case 'capabilities:updated':
      case 'command:session:created':
      case 'command:session:updated':
      case 'command:session:message':
      case 'command:session:idle':
      case 'command:session:stopped':
      case 'command:session:error':
      case 'command:session:deleted':
      case 'project:path-changed':
      case 'projects:import-completed':
      // Browser overlay lifecycle — forwarding events to renderer
      // falls through
      case 'browser:open-overlay':
      case 'browser:close-overlay':
      // Browser view events — forwarding to renderer
      // falls through
      case 'browser:view:opened':
      case 'browser:view:closed':
      case 'browser:navigated':
      case 'browser:loading':
      case 'browser:executor:state-changed':
      case 'browser:context':
      case 'browser:command:started':
      case 'browser:command:completed':
      // Tray popover events — forwarding to renderer
      // falls through
      case 'tray:navigate-issue':
      case 'tray:issues-updated':
        // Forwarding events — renderer handles state
        break
    }
  }

  private applyHookToSession(event: HookEvent): void {
    const session = this.state.sessions.find((s) => s.id === event.sessionId)
    if (!session) return

    const previousStatus = session.status

    const normalizedEventType = event.eventType ?? mapHookEventType(event.rawEventName)

    switch (normalizedEventType) {
      case 'session_start':
        session.status = 'active'
        break
      case 'session_stop':
      case 'session_end':
        session.status = 'completed'
        break
      case 'notification': {
        const reason = event.payload.type as string | undefined
        if (reason === 'permission_prompt' || reason === 'idle_prompt') {
          session.status = 'waiting'
        }
        break
      }
      case 'session_error':
        session.status = 'error'
        break
    }

    // Operational (non-signal) events still come through `rawEventName`.
    if (normalizedEventType === null && (event.rawEventName === 'PreToolUse' || event.rawEventName === 'PostToolUse')) {
      session.status = 'active'
    }

    session.lastActivity = Date.now()

    if (session.status !== previousStatus) {
      const transition: StatusTransition = {
        sessionId: session.id,
        sessionName: session.name,
        previousStatus,
        newStatus: session.status,
        timestamp: Date.now()
      }
      for (const listener of this.statusTransitionListeners) {
        listener(transition)
      }
    }
  }
}
