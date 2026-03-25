// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileContentAccessService } from '../../../electron/services/fileAccess'

describe('FileContentAccessService', () => {
  let tempRoot: string
  let service: FileContentAccessService

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'opencow-file-access-service-'))
    service = new FileContentAccessService()
  })

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  it('reads project files within the project root', async () => {
    const projectRoot = path.join(tempRoot, 'project')
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'src', 'index.ts'), 'export const ok = true\n', 'utf-8')

    const result = await service.readProjectFile(projectRoot, 'src/index.ts')

    expect(result).toMatchObject({
      ok: true,
      data: {
        language: 'typescript',
      },
    })
    if (result.ok) {
      expect(result.data.content).toContain('ok = true')
    }
  })

  it('rejects traversal outside the project root', async () => {
    const projectRoot = path.join(tempRoot, 'project')
    await fs.mkdir(projectRoot, { recursive: true })

    const result = await service.readProjectFile(projectRoot, '../outside.txt')

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'access_denied',
      },
    })
  })

  it('reports session service unavailable when session lookup is missing', async () => {
    const result = await service.readSessionToolFile({
      input: {
        sessionId: 'sess-1',
        filePath: 'README.md',
      },
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'session_service_unavailable',
      },
    })
  })

  it('blocks symlink writes when saving project files', async () => {
    const projectRoot = path.join(tempRoot, 'project')
    const outsideFile = path.join(tempRoot, 'outside.txt')
    await fs.mkdir(projectRoot, { recursive: true })
    await fs.writeFile(outsideFile, 'outside-before', 'utf-8')
    await fs.symlink(outsideFile, path.join(projectRoot, 'linked.txt'))

    const result = await service.saveProjectFile(projectRoot, 'linked.txt', 'inside-write')

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'symlink_blocked',
      },
    })
    await expect(fs.readFile(outsideFile, 'utf-8')).resolves.toBe('outside-before')
  })

  it('validates capability bundle read input before filesystem access', async () => {
    const result = await service.readCapabilityBundleFile({
      input: {
        projectId: 'project-1',
        bundle: {
          skillFilePath: '/tmp/SKILL.md',
          relativePath: '/tmp/absolute.txt',
        },
      },
      bundleFileName: 'SKILL.md',
      resolveProjectPathFromId: async () => undefined,
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'invalid_input',
      },
    })
  })

  it('skips symlink entries when listing capability bundle files', async () => {
    const projectRoot = path.join(tempRoot, 'project')
    const skillFilePath = path.join(projectRoot, '.opencow-dev', 'skills', 'alpha', 'SKILL.md')
    const scriptsDir = path.join(path.dirname(skillFilePath), 'scripts')
    await fs.mkdir(scriptsDir, { recursive: true })
    await fs.writeFile(skillFilePath, '# alpha', 'utf-8')
    await fs.writeFile(path.join(scriptsDir, 'run.sh'), 'echo run', 'utf-8')
    const outsideFile = path.join(tempRoot, 'outside.txt')
    await fs.writeFile(outsideFile, 'outside', 'utf-8')
    await fs.symlink(outsideFile, path.join(scriptsDir, 'linked.txt'))

    const files = await service.listCapabilityBundleFiles({
      skillFilePath,
      projectId: 'project-1',
      bundleFileName: 'SKILL.md',
      resolveProjectPathFromId: async () => projectRoot,
    })

    const relPaths = files.map((item) => item.relativePath)
    expect(relPaths).toContain('scripts/run.sh')
    expect(relPaths).not.toContain('scripts/linked.txt')
  })
})
