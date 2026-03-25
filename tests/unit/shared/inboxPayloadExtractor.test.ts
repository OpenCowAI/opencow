// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import {
  extractProjectName,
  shortenSessionId,
  extractSummary,
  extractHookEventDisplayData,
  extractTypedDisplayData
} from '@shared/inboxPayloadExtractor'

describe('extractProjectName', () => {
  it('extracts last segment from path', () => {
    expect(extractProjectName('/Users/foo/workspace/my-project')).toBe('my-project')
  })

  it('handles trailing slashes', () => {
    expect(extractProjectName('/Users/foo/workspace/my-project/')).toBe('my-project')
  })

  it('handles single segment', () => {
    expect(extractProjectName('myproject')).toBe('myproject')
  })

  it('returns null for null/undefined', () => {
    expect(extractProjectName(null)).toBeNull()
    expect(extractProjectName(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extractProjectName('')).toBeNull()
  })
})

describe('shortenSessionId', () => {
  it('returns first 8 characters', () => {
    expect(shortenSessionId('a50dddd6-b25a-4f4e-b4ef-0442b5ba089b')).toBe('a50dddd6')
  })

  it('returns full string if shorter than 8', () => {
    expect(shortenSessionId('abc')).toBe('abc')
  })

  it('returns null for null/undefined', () => {
    expect(shortenSessionId(null)).toBeNull()
    expect(shortenSessionId(undefined)).toBeNull()
  })
})

describe('extractSummary', () => {
  it('extracts first non-empty line', () => {
    expect(extractSummary('Hello world\nSecond line')).toBe('Hello world')
  })

  it('skips empty leading lines', () => {
    expect(extractSummary('\n\n  \nActual content here')).toBe('Actual content here')
  })

  it('truncates long lines with ellipsis', () => {
    const longLine = 'A'.repeat(200)
    const result = extractSummary(longLine, 50)
    expect(result).toHaveLength(50)
    expect(result!.endsWith('\u2026')).toBe(true)
  })

  it('returns null for null/undefined', () => {
    expect(extractSummary(null)).toBeNull()
    expect(extractSummary(undefined)).toBeNull()
  })

  it('returns null for empty/whitespace-only string', () => {
    expect(extractSummary('')).toBeNull()
    expect(extractSummary('   \n  \n  ')).toBeNull()
  })

  it('respects custom maxLength', () => {
    expect(extractSummary('Short text', 100)).toBe('Short text')
    const result = extractSummary('This is a longer text for testing', 20)
    expect(result!.length).toBe(20)
  })
})

describe('extractHookEventDisplayData', () => {
  it('extracts all fields from a full payload', () => {
    const payload = {
      session_id: 'a50dddd6-b25a-4f4e-b4ef-0442b5ba089b',
      cwd: '/Users/alice/workspace/projects/my-project',
      last_assistant_message: 'I have completed the review.'
    }

    const result = extractHookEventDisplayData(payload)
    expect(result.projectName).toBe('my-project')
    expect(result.sessionIdShort).toBe('a50dddd6')
    expect(result.summary).toBe('I have completed the review.')
    expect(result.cwd).toBe('/Users/alice/workspace/projects/my-project')
  })

  it('handles missing fields gracefully', () => {
    const result = extractHookEventDisplayData({})
    expect(result.projectName).toBeNull()
    expect(result.sessionIdShort).toBeNull()
    expect(result.summary).toBeNull()
    expect(result.cwd).toBeNull()
  })

  it('extracts projectName even without last_assistant_message', () => {
    const result = extractHookEventDisplayData({
      cwd: '/home/user/my-project',
      session_id: 'abc12345-def'
    })
    expect(result.projectName).toBe('my-project')
    expect(result.sessionIdShort).toBe('abc12345')
    expect(result.summary).toBeNull()
  })
})

describe('extractTypedDisplayData', () => {
  describe('session_start', () => {
    it('extracts source and model', () => {
      const result = extractTypedDisplayData('session_start', {
        session_id: 'abc12345-def',
        cwd: '/Users/foo/workspace/my-project',
        source: 'resume',
        model: 'claude-opus-4-6',
        agent_type: 'code-reviewer'
      })
      expect(result.eventType).toBe('session_start')
      expect(result.data.projectName).toBe('my-project')
      expect(result.data.sessionIdShort).toBe('abc12345')
      expect(result.data.source).toBe('resume')
      expect(result.data.model).toBe('claude-opus-4-6')
      expect(result.data.agentType).toBe('code-reviewer')
    })

    it('provides defaults for missing fields', () => {
      const result = extractTypedDisplayData('session_start', {})
      expect(result.data.source).toBe('startup')
      expect(result.data.model).toBe('unknown')
      expect(result.data.agentType).toBeNull()
    })
  })

  describe('session_stop', () => {
    it('extracts last_assistant_message', () => {
      const result = extractTypedDisplayData('session_stop', {
        session_id: 'abc12345-def',
        cwd: '/Users/foo/workspace/my-project',
        last_assistant_message: 'I completed the code review.\nAll tests pass.'
      })
      expect(result.eventType).toBe('session_stop')
      expect(result.data.lastMessage).toBe('I completed the code review.\nAll tests pass.')
    })

    it('handles missing last_assistant_message', () => {
      const result = extractTypedDisplayData('session_stop', {})
      expect(result.data.lastMessage).toBeNull()
    })
  })

  describe('task_completed', () => {
    it('extracts task fields', () => {
      const result = extractTypedDisplayData('task_completed', {
        cwd: '/Users/foo/workspace/my-project',
        task_id: '42',
        task_subject: 'Fix authentication bug',
        task_description: 'Detailed description...',
        teammate_name: 'agent-1',
        team_name: 'my-team'
      })
      expect(result.eventType).toBe('task_completed')
      expect(result.data.taskId).toBe('42')
      expect(result.data.taskSubject).toBe('Fix authentication bug')
      expect(result.data.taskDescription).toBe('Detailed description...')
      expect(result.data.teammateName).toBe('agent-1')
      expect(result.data.teamName).toBe('my-team')
    })

    it('handles missing optional fields', () => {
      const result = extractTypedDisplayData('task_completed', {
        task_subject: 'Do something'
      })
      expect(result.data.taskSubject).toBe('Do something')
      expect(result.data.taskDescription).toBeNull()
      expect(result.data.teammateName).toBeNull()
      expect(result.data.teamName).toBeNull()
    })
  })

  describe('notification', () => {
    it('extracts notification fields', () => {
      const result = extractTypedDisplayData('notification', {
        cwd: '/Users/foo/workspace/my-project',
        title: 'Permission needed',
        message: 'Approve Bash execution',
        notification_type: 'permission_prompt'
      })
      expect(result.eventType).toBe('notification')
      expect(result.data.title).toBe('Permission needed')
      expect(result.data.message).toBe('Approve Bash execution')
      expect(result.data.notificationType).toBe('permission_prompt')
    })

    it('handles missing fields', () => {
      const result = extractTypedDisplayData('notification', {})
      expect(result.data.title).toBeNull()
      expect(result.data.message).toBeNull()
      expect(result.data.notificationType).toBeNull()
    })
  })

  describe('session_error', () => {
    it('extracts tool and error info', () => {
      const result = extractTypedDisplayData('session_error', {
        cwd: '/Users/foo/workspace/my-project',
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
        error: 'Command failed with exit code 1'
      })
      expect(result.eventType).toBe('session_error')
      expect(result.data.toolName).toBe('Bash')
      expect(result.data.toolInput).toEqual({ command: 'npm test' })
      expect(result.data.error).toBe('Command failed with exit code 1')
    })

    it('handles missing fields', () => {
      const result = extractTypedDisplayData('session_error', {})
      expect(result.data.toolName).toBeNull()
      expect(result.data.toolInput).toBeNull()
      expect(result.data.error).toBeNull()
    })
  })
})
