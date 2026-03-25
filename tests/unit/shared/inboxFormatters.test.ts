// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import type {
  HookEventMessage,
  SmartReminderMessage,
  InboxMessage
} from '../../../src/shared/types'
import {
  deriveMessagePriority,
  formatMessageTitle,
  formatMessageProjectName,
  formatMessageSubtitle,
  formatMessageBody,
  formatRelativeTime
} from '../../../src/shared/inboxFormatters'

// === Factory helpers ===

function makeHookEvent(overrides: Partial<HookEventMessage> = {}): HookEventMessage {
  return {
    id: 'test-1',
    category: 'hook_event',
    eventType: 'session_error',
    status: 'unread',
    createdAt: Date.now(),
    projectId: 'proj-1',
    sessionId: 'sess-1',
    navigationTarget: {
      kind: 'session',
      projectId: 'proj-1',
      sessionId: 'sess-1',
    },
    rawPayload: {},
    ...overrides
  }
}

function makeReminder(overrides: Partial<SmartReminderMessage> = {}): SmartReminderMessage {
  return {
    id: 'test-2',
    category: 'smart_reminder',
    reminderType: 'idle_session',
    status: 'unread',
    createdAt: Date.now(),
    context: {
      sessionId: 'sess-1',
      idleDurationMs: 7200000,
      lastActivity: Date.now() - 7200000
    },
    ...overrides
  }
}

describe('inboxFormatters', () => {
  describe('deriveMessagePriority', () => {
    describe('hook events', () => {
      it('returns high for session_error', () => {
        expect(deriveMessagePriority(makeHookEvent({ eventType: 'session_error' }))).toBe('high')
      })

      it('returns normal for task_completed', () => {
        expect(deriveMessagePriority(makeHookEvent({ eventType: 'task_completed' }))).toBe('normal')
      })

      it('returns normal for session_start', () => {
        expect(deriveMessagePriority(makeHookEvent({ eventType: 'session_start' }))).toBe('normal')
      })

      it('returns normal for notification', () => {
        expect(deriveMessagePriority(makeHookEvent({ eventType: 'notification' }))).toBe('normal')
      })

      it('returns normal for session_stop', () => {
        expect(deriveMessagePriority(makeHookEvent({ eventType: 'session_stop' }))).toBe('normal')
      })
    })

    describe('smart reminders', () => {
      it('returns high for error_spike', () => {
        expect(
          deriveMessagePriority(
            makeReminder({
              reminderType: 'error_spike',
              context: { projectId: 'proj-1', errorCount: 5, windowMs: 600000 }
            })
          )
        ).toBe('high')
      })

      it('returns normal for idle_session', () => {
        expect(
          deriveMessagePriority(
            makeReminder({
              reminderType: 'idle_session'
            })
          )
        ).toBe('normal')
      })

      it('returns low for daily_summary', () => {
        expect(
          deriveMessagePriority(
            makeReminder({
              reminderType: 'daily_summary',
              context: {
                date: '2026-02-22',
                sessionsCompleted: 3,
                tasksCompleted: 10,
                totalCostUSD: 2.5
              }
            })
          )
        ).toBe('low')
      })
    })
  })

  describe('formatMessageTitle', () => {
    describe('hook events without cwd', () => {
      it('returns "Session Error" for session_error', () => {
        expect(formatMessageTitle(makeHookEvent({ eventType: 'session_error' }))).toBe(
          'Session Error'
        )
      })

      it('returns "Task Completed" for task_completed', () => {
        expect(formatMessageTitle(makeHookEvent({ eventType: 'task_completed' }))).toBe(
          'Task Completed'
        )
      })

      it('returns "Session Started" for session_start', () => {
        expect(formatMessageTitle(makeHookEvent({ eventType: 'session_start' }))).toBe(
          'Session Started'
        )
      })

      it('returns "Session Stopped" for session_stop', () => {
        expect(formatMessageTitle(makeHookEvent({ eventType: 'session_stop' }))).toBe(
          'Session Stopped'
        )
      })

      it('returns "Notification" for notification', () => {
        expect(formatMessageTitle(makeHookEvent({ eventType: 'notification' }))).toBe(
          'Notification'
        )
      })
    })

    describe('hook events with cwd — title stays clean', () => {
      it('returns only event label, no project name', () => {
        expect(
          formatMessageTitle(
            makeHookEvent({
              eventType: 'session_stop',
              rawPayload: { cwd: '/Users/foo/workspace/my-project' }
            })
          )
        ).toBe('Session Stopped')
      })

      it('returns only event label for error with cwd', () => {
        expect(
          formatMessageTitle(
            makeHookEvent({
              eventType: 'session_error',
              rawPayload: { cwd: '/home/user/my-project' }
            })
          )
        ).toBe('Session Error')
      })
    })

    describe('smart reminders', () => {
      it('returns "Idle Session" for idle_session', () => {
        expect(formatMessageTitle(makeReminder({ reminderType: 'idle_session' }))).toBe(
          'Idle Session'
        )
      })

      it('returns "Error Spike Detected" for error_spike', () => {
        expect(
          formatMessageTitle(
            makeReminder({
              reminderType: 'error_spike',
              context: { projectId: 'proj-1', errorCount: 5, windowMs: 600000 }
            })
          )
        ).toBe('Error Spike Detected')
      })

      it('returns "Daily Summary" for daily_summary', () => {
        expect(
          formatMessageTitle(
            makeReminder({
              reminderType: 'daily_summary',
              context: {
                date: '2026-02-22',
                sessionsCompleted: 3,
                tasksCompleted: 10,
                totalCostUSD: 2.5
              }
            })
          )
        ).toBe('Daily Summary')
      })
    })
  })

  describe('formatMessageProjectName', () => {
    it('extracts project name from hook event cwd', () => {
      expect(
        formatMessageProjectName(
          makeHookEvent({
            rawPayload: { cwd: '/Users/foo/workspace/my-project' }
          })
        )
      ).toBe('my-project')
    })

    it('returns null for hook event without cwd', () => {
      expect(formatMessageProjectName(makeHookEvent())).toBeNull()
    })

    it('returns null for smart reminder without projectId in context', () => {
      expect(
        formatMessageProjectName(
          makeReminder({
            reminderType: 'idle_session'
          })
        )
      ).toBeNull()
    })

    it('returns projectId from error_spike context', () => {
      expect(
        formatMessageProjectName(
          makeReminder({
            reminderType: 'error_spike',
            context: { projectId: 'proj-1', errorCount: 5, windowMs: 600000 }
          })
        )
      ).toBe('proj-1')
    })
  })

  describe('formatMessageSubtitle', () => {
    describe('session_start', () => {
      it('shows source and model', () => {
        const subtitle = formatMessageSubtitle(
          makeHookEvent({
            eventType: 'session_start',
            rawPayload: { source: 'resume', model: 'claude-opus-4-6' }
          })
        )
        expect(subtitle).toBe('resume \u00B7 opus-4-6')
      })

      it('shows agent type when present', () => {
        const subtitle = formatMessageSubtitle(
          makeHookEvent({
            eventType: 'session_start',
            rawPayload: {
              source: 'startup',
              model: 'claude-sonnet-4-6',
              agent_type: 'code-reviewer'
            }
          })
        )
        expect(subtitle).toBe('startup \u00B7 sonnet-4-6 \u00B7 code-reviewer')
      })

      it('provides defaults for missing fields', () => {
        const subtitle = formatMessageSubtitle(
          makeHookEvent({
            eventType: 'session_start',
            rawPayload: {}
          })
        )
        expect(subtitle).toBe('startup \u00B7 unknown')
      })
    })

    describe('session_stop', () => {
      it('shows last assistant message summary', () => {
        const subtitle = formatMessageSubtitle(
          makeHookEvent({
            eventType: 'session_stop',
            rawPayload: { last_assistant_message: 'I completed the review successfully.' }
          })
        )
        expect(subtitle).toBe('I completed the review successfully.')
      })

      it('falls back to Session ID when no message', () => {
        const subtitle = formatMessageSubtitle(
          makeHookEvent({
            eventType: 'session_stop',
            rawPayload: { session_id: 'abc12345-def-456' }
          })
        )
        expect(subtitle).toBe('Session abc12345')
      })

      it('falls back to generic text', () => {
        const subtitle = formatMessageSubtitle(
          makeHookEvent({
            eventType: 'session_stop',
            rawPayload: {}
          })
        )
        expect(subtitle).toBe('Session completed')
      })
    })

    describe('task_completed', () => {
      it('shows task subject', () => {
        const subtitle = formatMessageSubtitle(
          makeHookEvent({
            eventType: 'task_completed',
            rawPayload: { task_subject: 'Fix authentication bug' }
          })
        )
        expect(subtitle).toBe('Fix authentication bug')
      })

      it('shows teammate info when present', () => {
        const subtitle = formatMessageSubtitle(
          makeHookEvent({
            eventType: 'task_completed',
            rawPayload: { task_subject: 'Fix auth', teammate_name: 'agent-1' }
          })
        )
        expect(subtitle).toBe('Fix auth \u00B7 agent-1')
      })

      it('falls back to generic text', () => {
        const subtitle = formatMessageSubtitle(
          makeHookEvent({
            eventType: 'task_completed',
            rawPayload: {}
          })
        )
        expect(subtitle).toBe('Task completed')
      })
    })

    describe('notification', () => {
      it('shows message content', () => {
        const subtitle = formatMessageSubtitle(
          makeHookEvent({
            eventType: 'notification',
            rawPayload: { message: 'Please approve Bash execution', title: 'Permission needed' }
          })
        )
        expect(subtitle).toBe('Please approve Bash execution')
      })

      it('falls back to title', () => {
        const subtitle = formatMessageSubtitle(
          makeHookEvent({
            eventType: 'notification',
            rawPayload: { title: 'Auth success' }
          })
        )
        expect(subtitle).toBe('Auth success')
      })

      it('falls back to generic text', () => {
        const subtitle = formatMessageSubtitle(
          makeHookEvent({
            eventType: 'notification',
            rawPayload: {}
          })
        )
        expect(subtitle).toBe('Notification received')
      })
    })

    describe('session_error', () => {
      it('shows tool name and error', () => {
        const subtitle = formatMessageSubtitle(
          makeHookEvent({
            eventType: 'session_error',
            rawPayload: { tool_name: 'Bash', error: 'Command failed with exit code 1' }
          })
        )
        expect(subtitle).toBe('Bash failed: Command failed with exit code 1')
      })

      it('shows just tool name when no error', () => {
        const subtitle = formatMessageSubtitle(
          makeHookEvent({
            eventType: 'session_error',
            rawPayload: { tool_name: 'Edit' }
          })
        )
        expect(subtitle).toBe('Edit failed')
      })

      it('falls back to generic text', () => {
        const subtitle = formatMessageSubtitle(
          makeHookEvent({
            eventType: 'session_error',
            rawPayload: {}
          })
        )
        expect(subtitle).toBe('Tool execution failed')
      })
    })

    describe('smart reminders (unchanged)', () => {
      it('returns idle duration for idle_session', () => {
        const subtitle = formatMessageSubtitle(
          makeReminder({
            reminderType: 'idle_session',
            context: { sessionId: 's1', idleDurationMs: 7200000, lastActivity: 0 }
          })
        )
        expect(subtitle).toContain('2h')
      })

      it('returns error count for error_spike', () => {
        const subtitle = formatMessageSubtitle(
          makeReminder({
            reminderType: 'error_spike',
            context: { projectId: 'p1', errorCount: 5, windowMs: 600000 }
          })
        )
        expect(subtitle).toBe('5 errors in 10min')
      })

      it('returns sessions and cost for daily_summary', () => {
        const subtitle = formatMessageSubtitle(
          makeReminder({
            reminderType: 'daily_summary',
            context: {
              date: '2026-02-22',
              sessionsCompleted: 3,
              tasksCompleted: 2,
              totalCostUSD: 2.5
            }
          })
        )
        expect(subtitle).toBe('3 sessions, $2.50')
      })
    })
  })

  describe('formatMessageBody', () => {
    describe('hook events', () => {
      describe('session_start', () => {
        it('shows source and model info', () => {
          const body = formatMessageBody(
            makeHookEvent({
              eventType: 'session_start',
              rawPayload: {
                source: 'resume',
                model: 'claude-opus-4-6',
                cwd: '/Users/foo/workspace/my-project',
                session_id: 'abc12345-def'
              }
            })
          )
          expect(body).toContain('**Source:** resume')
          expect(body).toContain('**Model:** claude-opus-4-6')
          expect(body).toContain('Project: my-project')
          expect(body).toContain('Session: abc12345')
        })

        it('shows agent type when present', () => {
          const body = formatMessageBody(
            makeHookEvent({
              eventType: 'session_start',
              rawPayload: {
                source: 'startup',
                model: 'claude-sonnet-4-6',
                agent_type: 'code-reviewer'
              }
            })
          )
          expect(body).toContain('**Agent:** code-reviewer')
        })
      })

      describe('session_stop', () => {
        it('shows full last assistant message', () => {
          const body = formatMessageBody(
            makeHookEvent({
              eventType: 'session_stop',
              rawPayload: {
                last_assistant_message: 'Task completed successfully.\nAll tests pass.',
                cwd: '/Users/foo/workspace/my-project',
                session_id: 'abc12345-def'
              }
            })
          )
          expect(body).toContain('Task completed successfully.\nAll tests pass.')
          expect(body).toContain('Project: my-project')
        })

        it('shows fallback when no message', () => {
          const body = formatMessageBody(
            makeHookEvent({
              eventType: 'session_stop',
              rawPayload: {}
            })
          )
          expect(body).toContain('Session Stopped')
        })
      })

      describe('task_completed', () => {
        it('shows task subject as heading and description', () => {
          const body = formatMessageBody(
            makeHookEvent({
              eventType: 'task_completed',
              rawPayload: {
                task_id: '42',
                task_subject: 'Fix authentication bug',
                task_description: 'Detailed description of the fix...',
                cwd: '/Users/foo/workspace/my-project'
              }
            })
          )
          expect(body).toContain('## Fix authentication bug')
          expect(body).toContain('Detailed description of the fix...')
          expect(body).toContain('**Task ID:** 42')
        })

        it('shows teammate info for agent teams', () => {
          const body = formatMessageBody(
            makeHookEvent({
              eventType: 'task_completed',
              rawPayload: {
                task_subject: 'Fix auth',
                teammate_name: 'agent-1',
                team_name: 'my-team'
              }
            })
          )
          expect(body).toContain('**Teammate:** agent-1')
          expect(body).toContain('**Team:** my-team')
        })

        it('shows fallback when no task subject', () => {
          const body = formatMessageBody(
            makeHookEvent({
              eventType: 'task_completed',
              rawPayload: {}
            })
          )
          expect(body).toContain('Task Completed')
        })
      })

      describe('notification', () => {
        it('shows title and message', () => {
          const body = formatMessageBody(
            makeHookEvent({
              eventType: 'notification',
              rawPayload: {
                title: 'Permission needed',
                message: 'Please approve Bash command execution.',
                notification_type: 'permission_prompt',
                cwd: '/Users/foo/workspace/my-project'
              }
            })
          )
          expect(body).toContain('## Permission needed')
          expect(body).toContain('Please approve Bash command execution.')
          expect(body).toContain('**Type:** permission_prompt')
        })

        it('shows fallback when no title/message', () => {
          const body = formatMessageBody(
            makeHookEvent({
              eventType: 'notification',
              rawPayload: {}
            })
          )
          expect(body).toContain('Notification received')
        })
      })

      describe('session_error', () => {
        it('shows tool name and error details', () => {
          const body = formatMessageBody(
            makeHookEvent({
              eventType: 'session_error',
              rawPayload: {
                tool_name: 'Bash',
                tool_input: { command: 'npm test', description: 'Run test suite' },
                error: 'Command failed with exit code 1',
                cwd: '/Users/foo/workspace/my-project'
              }
            })
          )
          expect(body).toContain('**Tool:** Bash')
          expect(body).toContain('npm test')
          expect(body).toContain('Command failed with exit code 1')
        })

        it('shows fallback when no tool info', () => {
          const body = formatMessageBody(
            makeHookEvent({
              eventType: 'session_error',
              rawPayload: {}
            })
          )
          expect(body).toContain('Session Error')
        })
      })
    })

    describe('smart reminders', () => {
      it('formats idle duration in hours and minutes for idle_session', () => {
        const msg = makeReminder({
          reminderType: 'idle_session',
          context: {
            sessionId: 'sess-1',
            idleDurationMs: 7200000,
            lastActivity: Date.now() - 7200000
          }
        })
        const body = formatMessageBody(msg)
        expect(body).toContain('2h')
      })

      it('includes session count and cost for daily_summary', () => {
        const msg = makeReminder({
          reminderType: 'daily_summary',
          context: {
            date: '2026-02-22',
            sessionsCompleted: 3,
            tasksCompleted: 10,
            totalCostUSD: 2.5
          }
        })
        const body = formatMessageBody(msg)
        expect(body).toContain('3 sessions completed')
        expect(body).toContain('$2.50')
      })

      it('includes error count for error_spike', () => {
        const msg = makeReminder({
          reminderType: 'error_spike',
          context: {
            projectId: 'proj-1',
            errorCount: 5,
            windowMs: 600000
          }
        })
        const body = formatMessageBody(msg)
        expect(body).toContain('5 errors')
      })
    })
  })

  describe('formatRelativeTime', () => {
    it('formats seconds for < 60s', () => {
      const now = Date.now()
      const thirtySecondsAgo = now - 30 * 1000
      expect(formatRelativeTime(thirtySecondsAgo, now)).toBe('30s ago')
    })

    it('formats minutes for < 3600s', () => {
      const now = Date.now()
      const twoMinutesAgo = now - 120 * 1000
      expect(formatRelativeTime(twoMinutesAgo, now)).toBe('2m ago')
    })

    it('formats hours for < 86400s', () => {
      const now = Date.now()
      const twoHoursAgo = now - 7200 * 1000
      expect(formatRelativeTime(twoHoursAgo, now)).toBe('2h ago')
    })

    it('formats days for >= 86400s', () => {
      const now = Date.now()
      const twoDaysAgo = now - 172800 * 1000
      expect(formatRelativeTime(twoDaysAgo, now)).toBe('2d ago')
    })

    it('returns "just now" for 0 difference', () => {
      const now = Date.now()
      expect(formatRelativeTime(now, now)).toBe('just now')
    })

    it('uses current time when now is not provided', () => {
      const recent = Date.now() - 5000
      const result = formatRelativeTime(recent)
      // Should be approximately 5s ago (allow some test execution time)
      expect(result).toMatch(/^\d+s ago$/)
    })
  })
})
