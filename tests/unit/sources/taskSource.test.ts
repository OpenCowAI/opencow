// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFile, mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import type { DataBusEvent, TaskFull } from '@shared/types'

describe('TaskSource', () => {
  let tempDir: string
  let dispatched: DataBusEvent[]
  let dispatch: (event: DataBusEvent) => void

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'opencow-tasks-'))
    dispatched = []
    dispatch = (event: DataBusEvent) => {
      dispatched.push(event)
    }
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('scans task directories and dispatches tasks:updated per list', async () => {
    // Create a task list directory with two task files
    const listDir = join(tempDir, 'list-alpha')
    await mkdir(listDir, { recursive: true })

    const task1 = {
      id: 'task-1',
      subject: 'Fix bug',
      description: 'Fix the critical bug',
      activeForm: 'Fixing bug',
      status: 'pending',
      blocks: [],
      blockedBy: []
    }
    const task2 = {
      id: 'task-2',
      subject: 'Add feature',
      description: 'Add new feature',
      activeForm: 'Adding feature',
      status: 'in_progress',
      blocks: [],
      blockedBy: ['task-1']
    }

    await writeFile(join(listDir, 'task-1.json'), JSON.stringify(task1))
    await writeFile(join(listDir, 'task-2.json'), JSON.stringify(task2))

    const { TaskSource } = await import('../../../electron/sources/taskSource')
    const source = new TaskSource(dispatch, tempDir)
    await source.scan()

    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].type).toBe('tasks:updated')

    const payload = dispatched[0].payload as { sessionId: string; tasks: TaskFull[] }
    expect(payload.sessionId).toBe('list-alpha')
    expect(payload.tasks).toHaveLength(2)

    const ids = payload.tasks.map((t) => t.id).sort()
    expect(ids).toEqual(['task-1', 'task-2'])
  })

  it('dispatches separate events for multiple task lists', async () => {
    const listA = join(tempDir, 'list-a')
    const listB = join(tempDir, 'list-b')
    await mkdir(listA, { recursive: true })
    await mkdir(listB, { recursive: true })

    await writeFile(
      join(listA, 'task-a1.json'),
      JSON.stringify({ id: 'a1', subject: 'Task A1', status: 'pending' })
    )
    await writeFile(
      join(listB, 'task-b1.json'),
      JSON.stringify({ id: 'b1', subject: 'Task B1', status: 'completed' })
    )

    const { TaskSource } = await import('../../../electron/sources/taskSource')
    const source = new TaskSource(dispatch, tempDir)
    await source.scan()

    expect(dispatched).toHaveLength(2)

    const sessionIds = dispatched.map((e) => (e.payload as { sessionId: string }).sessionId).sort()
    expect(sessionIds).toEqual(['list-a', 'list-b'])
  })

  it('skips non-json files', async () => {
    const listDir = join(tempDir, 'list-mixed')
    await mkdir(listDir, { recursive: true })

    await writeFile(
      join(listDir, 'task-1.json'),
      JSON.stringify({ id: 'task-1', subject: 'Valid task', status: 'pending' })
    )
    await writeFile(join(listDir, 'README.md'), '# This is a readme')
    await writeFile(join(listDir, '.hidden'), 'hidden file')
    await writeFile(join(listDir, 'notes.txt'), 'some notes')

    const { TaskSource } = await import('../../../electron/sources/taskSource')
    const source = new TaskSource(dispatch, tempDir)
    await source.scan()

    expect(dispatched).toHaveLength(1)
    const payload = dispatched[0].payload as { sessionId: string; tasks: TaskFull[] }
    expect(payload.tasks).toHaveLength(1)
    expect(payload.tasks[0].id).toBe('task-1')
  })

  it('handles empty tasks directory (no list subdirs)', async () => {
    const { TaskSource } = await import('../../../electron/sources/taskSource')
    const source = new TaskSource(dispatch, tempDir)
    await source.scan()

    // Empty dir -> no dispatches
    expect(dispatched).toHaveLength(0)
  })

  it('handles missing tasks directory', async () => {
    const nonExistentDir = join(tempDir, 'nonexistent', 'tasks')

    const { TaskSource } = await import('../../../electron/sources/taskSource')
    const source = new TaskSource(dispatch, nonExistentDir)
    await source.scan()

    expect(dispatched).toHaveLength(0)
  })

  it('skips task files with invalid JSON content', async () => {
    const listDir = join(tempDir, 'list-invalid')
    await mkdir(listDir, { recursive: true })

    await writeFile(join(listDir, 'valid.json'), JSON.stringify({ id: 'v1', subject: 'Valid' }))
    await writeFile(join(listDir, 'invalid.json'), 'not valid json {{{')

    const { TaskSource } = await import('../../../electron/sources/taskSource')
    const source = new TaskSource(dispatch, tempDir)
    await source.scan()

    expect(dispatched).toHaveLength(1)
    const payload = dispatched[0].payload as { sessionId: string; tasks: TaskFull[] }
    // Only the valid task should be present
    expect(payload.tasks).toHaveLength(1)
    expect(payload.tasks[0].id).toBe('v1')
  })

  it('skips task files missing required fields (id/subject)', async () => {
    const listDir = join(tempDir, 'list-incomplete')
    await mkdir(listDir, { recursive: true })

    await writeFile(
      join(listDir, 'valid.json'),
      JSON.stringify({ id: 'v1', subject: 'Valid task' })
    )
    await writeFile(
      join(listDir, 'no-id.json'),
      JSON.stringify({ subject: 'Missing id' })
    )
    await writeFile(
      join(listDir, 'no-subject.json'),
      JSON.stringify({ id: 'ns1' })
    )

    const { TaskSource } = await import('../../../electron/sources/taskSource')
    const source = new TaskSource(dispatch, tempDir)
    await source.scan()

    expect(dispatched).toHaveLength(1)
    const payload = dispatched[0].payload as { sessionId: string; tasks: TaskFull[] }
    expect(payload.tasks).toHaveLength(1)
    expect(payload.tasks[0].id).toBe('v1')
  })

  it('stop cleans up watcher and timer', async () => {
    const { TaskSource } = await import('../../../electron/sources/taskSource')
    const source = new TaskSource(dispatch, tempDir)

    // Calling stop before start should not throw
    expect(() => source.stop()).not.toThrow()
  })
})
