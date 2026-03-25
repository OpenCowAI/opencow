// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'
import os from 'node:os'

vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
  }
}))

vi.mock('../../../electron/security/pathValidator', () => ({
  validateCapabilityPath: vi.fn()
}))

import { moveToTrash } from '../../../electron/services/trashService'
import fs from 'node:fs/promises'
import { validateCapabilityPath } from '../../../electron/security/pathValidator'

describe('trashService', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('moves file to global trash with timestamp suffix', async () => {
    const source = path.join(os.homedir(), '.claude', 'commands', 'deploy.md')
    const result = await moveToTrash(source)

    expect(fs.mkdir).toHaveBeenCalledWith(
      expect.stringContaining(path.join('.claude', '.trash')),
      { recursive: true }
    )
    expect(fs.rename).toHaveBeenCalled()
    expect(result.success).toBe(true)
    expect(result.trashPath).toMatch(/deploy\.\d+\.md$/)
  })

  it('uses project trash when sourcePath is within project .claude/', async () => {
    const result = await moveToTrash('/project/.claude/commands/deploy.md', '/project')

    expect(fs.mkdir).toHaveBeenCalledWith(
      expect.stringContaining(path.join('/project', '.claude', '.trash')),
      { recursive: true }
    )
    expect(result.success).toBe(true)
  })

  it('handles directories (skill folders)', async () => {
    const source = path.join(os.homedir(), '.claude', 'skills', 'my-skill')
    const result = await moveToTrash(source)

    expect(fs.rename).toHaveBeenCalled()
    expect(result.trashPath).toContain('my-skill')
  })

  it('calls validateCapabilityPath for security', async () => {
    const source = path.join(os.homedir(), '.claude', 'commands', 'test.md')
    await moveToTrash(source)

    expect(validateCapabilityPath).toHaveBeenCalledWith(source, undefined)
  })
})
