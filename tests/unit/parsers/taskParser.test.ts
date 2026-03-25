// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { parseTaskFile, groupTasksByStatus } from '../../../electron/parsers/taskParser'
import type { TaskFull, TaskGroup } from '@shared/types'

describe('taskParser', () => {
  describe('parseTaskFile', () => {
    it('parses a valid task JSON with all fields', () => {
      const content = JSON.stringify({
        id: 'task-1',
        subject: 'Fix the bug',
        description: 'There is a bug in the login flow',
        activeForm: 'Fixing the bug',
        status: 'in_progress',
        blocks: ['task-2', 'task-3'],
        blockedBy: ['task-0']
      })

      const result = parseTaskFile(content)

      expect(result).toEqual({
        id: 'task-1',
        subject: 'Fix the bug',
        description: 'There is a bug in the login flow',
        activeForm: 'Fixing the bug',
        status: 'in_progress',
        blocks: ['task-2', 'task-3'],
        blockedBy: ['task-0']
      })
    })

    it('applies defaults for missing optional fields', () => {
      const content = JSON.stringify({
        id: 'task-2',
        subject: 'Write tests'
      })

      const result = parseTaskFile(content)

      expect(result).toEqual({
        id: 'task-2',
        subject: 'Write tests',
        description: '',
        activeForm: '',
        status: 'pending',
        blocks: [],
        blockedBy: []
      })
    })

    it('returns null for invalid JSON', () => {
      expect(parseTaskFile('not json at all')).toBeNull()
      expect(parseTaskFile('{broken')).toBeNull()
      expect(parseTaskFile('')).toBeNull()
    })

    it('returns null when id is missing', () => {
      const content = JSON.stringify({
        subject: 'No id task'
      })

      expect(parseTaskFile(content)).toBeNull()
    })

    it('returns null when subject is missing', () => {
      const content = JSON.stringify({
        id: 'task-3'
      })

      expect(parseTaskFile(content)).toBeNull()
    })

    it('returns null when both id and subject are missing', () => {
      const content = JSON.stringify({
        description: 'orphan task data'
      })

      expect(parseTaskFile(content)).toBeNull()
    })

    it('returns null when id is not a string', () => {
      const content = JSON.stringify({
        id: 123,
        subject: 'Bad id type'
      })

      expect(parseTaskFile(content)).toBeNull()
    })

    it('returns null when subject is not a string', () => {
      const content = JSON.stringify({
        id: 'task-4',
        subject: 42
      })

      expect(parseTaskFile(content)).toBeNull()
    })

    it('normalizes invalid status to pending', () => {
      const content = JSON.stringify({
        id: 'task-5',
        subject: 'Bad status',
        status: 'unknown_status'
      })

      const result = parseTaskFile(content)
      expect(result?.status).toBe('pending')
    })
  })

  describe('groupTasksByStatus', () => {
    const makeTasks = (): TaskFull[] => [
      { id: '1', subject: 'Pending A', description: '', activeForm: '', status: 'pending', blocks: [], blockedBy: [] },
      { id: '2', subject: 'In Progress A', description: '', activeForm: '', status: 'in_progress', blocks: [], blockedBy: [] },
      { id: '3', subject: 'Completed A', description: '', activeForm: '', status: 'completed', blocks: [], blockedBy: [] },
      { id: '4', subject: 'Pending B', description: '', activeForm: '', status: 'pending', blocks: [], blockedBy: [] },
      { id: '5', subject: 'In Progress B', description: '', activeForm: '', status: 'in_progress', blocks: [], blockedBy: [] }
    ]

    it('groups tasks in order: in_progress, pending, completed', () => {
      const tasks = makeTasks()
      const groups = groupTasksByStatus(tasks)

      expect(groups).toHaveLength(3)
      expect(groups[0].status).toBe('in_progress')
      expect(groups[1].status).toBe('pending')
      expect(groups[2].status).toBe('completed')
    })

    it('assigns correct label to each group', () => {
      const tasks = makeTasks()
      const groups = groupTasksByStatus(tasks)

      expect(groups[0].label).toBe('In Progress')
      expect(groups[1].label).toBe('Pending')
      expect(groups[2].label).toBe('Completed')
    })

    it('assigns correct tasks to each group', () => {
      const tasks = makeTasks()
      const groups = groupTasksByStatus(tasks)

      // in_progress group
      expect(groups[0].tasks).toHaveLength(2)
      expect(groups[0].tasks.map((t: TaskFull) => t.id)).toEqual(['2', '5'])

      // pending group
      expect(groups[1].tasks).toHaveLength(2)
      expect(groups[1].tasks.map((t: TaskFull) => t.id)).toEqual(['1', '4'])

      // completed group
      expect(groups[2].tasks).toHaveLength(1)
      expect(groups[2].tasks.map((t: TaskFull) => t.id)).toEqual(['3'])
    })

    it('omits empty groups', () => {
      const tasks: TaskFull[] = [
        { id: '1', subject: 'Only pending', description: '', activeForm: '', status: 'pending', blocks: [], blockedBy: [] }
      ]

      const groups = groupTasksByStatus(tasks)

      expect(groups).toHaveLength(1)
      expect(groups[0].status).toBe('pending')
    })

    it('returns empty array for empty input', () => {
      expect(groupTasksByStatus([])).toEqual([])
    })
  })
})
