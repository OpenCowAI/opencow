// SPDX-License-Identifier: Apache-2.0

import { readFile, readdir, stat } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import chokidar, { type FSWatcher } from 'chokidar'
import { parseTaskFile } from '../parsers/taskParser'
import type { DataBusEvent, TaskFull } from '@shared/types'
import { createLogger } from '../platform/logger'

const log = createLogger('TaskSource')

const DEFAULT_TASKS_DIR = join(homedir(), '.claude', 'tasks')

export class TaskSource {
  private dispatch: (event: DataBusEvent) => void
  private tasksDir: string
  private watcher: FSWatcher | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  constructor(dispatch: (event: DataBusEvent) => void, tasksDir?: string) {
    this.dispatch = dispatch
    this.tasksDir = tasksDir ?? DEFAULT_TASKS_DIR
  }

  async start(): Promise<void> {
    await this.scan()

    try {
      this.watcher = chokidar.watch(this.tasksDir, {
        ignoreInitial: true,
        depth: 2
      })

      this.watcher.on('all', () => {
        this.debouncedRescan()
      })
      log.info('TaskSource started with file watcher', { tasksDir: this.tasksDir })
    } catch {
      // Directory might not exist yet — watcher setup failure is non-fatal
      log.warn('TaskSource failed to attach watcher (non-fatal)', { tasksDir: this.tasksDir })
    }
  }

  private debouncedRescan(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.scan().catch((e) => log.error('Scan failed', e))
    }, 500)
  }

  async scan(): Promise<void> {
    try {
      // Check if tasks directory exists
      const dirStat = await stat(this.tasksDir)
      if (!dirStat.isDirectory()) return

      // Read top-level entries (each is a task list directory)
      const entries = await readdir(this.tasksDir, { withFileTypes: true })
      const listDirs = entries.filter((entry) => entry.isDirectory())
      let totalLists = 0
      let totalTasks = 0

      for (const listDir of listDirs) {
        const listPath = join(this.tasksDir, listDir.name)
        const tasks = await this.scanListDir(listPath)
        totalLists += 1
        totalTasks += tasks.length

        this.dispatch({
          type: 'tasks:updated',
          payload: { sessionId: listDir.name, tasks }
        })
      }
      log.debug('TaskSource scan completed', {
        tasksDir: this.tasksDir,
        listCount: totalLists,
        taskCount: totalTasks,
      })
    } catch (err) {
      // Directory might not exist or be unreadable
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        log.warn('TaskSource scan failed', { tasksDir: this.tasksDir }, err)
      }
    }
  }

  private async scanListDir(listPath: string): Promise<TaskFull[]> {
    const tasks: TaskFull[] = []

    try {
      const files = await readdir(listPath)

      for (const file of files) {
        // Skip non-.json files
        if (!file.endsWith('.json')) continue

        try {
          const filePath = join(listPath, file)
          const content = await readFile(filePath, 'utf-8')
          const task = parseTaskFile(content)

          if (task !== null) {
            tasks.push(task)
          }
        } catch {
          // Individual file read/parse failure — skip this file
        }
      }
    } catch {
      // Directory read failure — return empty array
    }

    return tasks
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    log.info('TaskSource stopped', { tasksDir: this.tasksDir })
  }
}
