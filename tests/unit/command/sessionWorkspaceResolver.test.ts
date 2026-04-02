// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { realpathSync } from 'node:fs'
import {
  SessionWorkspaceResolver,
  SessionWorkspaceResolutionError,
} from '../../../electron/command/sessionWorkspaceResolver'

describe('SessionWorkspaceResolver', () => {
  let tempRoot: string

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'oc-workspace-resolver-'))
  })

  it('resolves global workspace to user home', async () => {
    const resolver = new SessionWorkspaceResolver()
    const resolved = await resolver.resolve({ scope: 'global' })
    expect(resolved.scope).toBe('global')
    expect(resolved.projectId).toBeNull()
    expect(resolved.projectPath).toBeNull()
    expect(resolved.cwd.length).toBeGreaterThan(0)
  })

  it('resolves project workspace via canonical path', async () => {
    const resolver = new SessionWorkspaceResolver({
      resolveProjectById: async (projectId) => ({ id: projectId, canonicalPath: '/tmp/demo-project' }),
    })
    const resolved = await resolver.resolve({ scope: 'project', projectId: 'proj-1' })
    expect(resolved).toEqual({
      scope: 'project',
      cwd: '/tmp/demo-project',
      projectId: 'proj-1',
      projectPath: '/tmp/demo-project',
    })
  })

  it('rejects relative custom-path workspace', async () => {
    const resolver = new SessionWorkspaceResolver()
    await expect(resolver.resolve({ scope: 'custom-path', cwd: 'relative/path' }))
      .rejects
      .toMatchObject({ code: 'CUSTOM_CWD_NOT_ABSOLUTE' } as Partial<SessionWorkspaceResolutionError>)
  })

  it('rejects missing custom-path workspace', async () => {
    const resolver = new SessionWorkspaceResolver()
    await expect(resolver.resolve({ scope: 'custom-path', cwd: join(tempRoot, 'missing') }))
      .rejects
      .toMatchObject({ code: 'CUSTOM_CWD_NOT_FOUND' } as Partial<SessionWorkspaceResolutionError>)
  })

  it('rejects custom-path that is a file', async () => {
    const resolver = new SessionWorkspaceResolver()
    const filePath = join(tempRoot, 'file.txt')
    await writeFile(filePath, 'x', 'utf-8')
    await expect(resolver.resolve({ scope: 'custom-path', cwd: filePath }))
      .rejects
      .toMatchObject({ code: 'CUSTOM_CWD_NOT_DIRECTORY' } as Partial<SessionWorkspaceResolutionError>)
  })

  it('normalizes custom-path to realpath', async () => {
    const resolver = new SessionWorkspaceResolver()
    const nestedDir = join(tempRoot, 'nested')
    await mkdir(nestedDir)
    const withDots = join(tempRoot, 'nested', '..', 'nested')
    const resolved = await resolver.resolve({ scope: 'custom-path', cwd: withDots })
    expect(resolved.scope).toBe('custom-path')
    expect(resolved.cwd).toBe(realpathSync(nestedDir))
  })

  it('rejects project workspace when resolver is unavailable', async () => {
    const resolver = new SessionWorkspaceResolver()
    await expect(resolver.resolve({ scope: 'project', projectId: 'proj-1' }))
      .rejects
      .toMatchObject({ code: 'PROJECT_NOT_FOUND' } as Partial<SessionWorkspaceResolutionError>)
  })

  it('rejects project workspace when canonical path is empty', async () => {
    const resolver = new SessionWorkspaceResolver({
      resolveProjectById: async (projectId) => ({ id: projectId, canonicalPath: '   ' }),
    })
    await expect(resolver.resolve({ scope: 'project', projectId: 'proj-1' }))
      .rejects
      .toMatchObject({ code: 'PROJECT_PATH_EMPTY' } as Partial<SessionWorkspaceResolutionError>)
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
})
