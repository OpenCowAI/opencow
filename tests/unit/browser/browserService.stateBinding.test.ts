// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { BrowserService } from '../../../electron/browser/browserService'

describe('BrowserService.resolveStateBinding', () => {
  it('uses custom-profile when preferredProfileId is provided', async () => {
    const service = new BrowserService({
      dispatch: vi.fn() as never,
      store: {} as never,
    })
    const resolveProfileIdSpy = vi.fn().mockResolvedValue('profile-preferred')
    ;(service as unknown as { resolveProfileId: (id?: string) => Promise<string> }).resolveProfileId =
      resolveProfileIdSpy

    const binding = await service.resolveStateBinding({
      source: { type: 'chat-session', sessionId: 'session-1' },
      preferredProfileId: 'preferred-1',
      projectId: 'project-1',
    })

    expect(resolveProfileIdSpy).toHaveBeenCalledWith('preferred-1')
    expect(binding).toMatchObject({
      policy: 'custom-profile',
      profileId: 'profile-preferred',
      sourceType: 'chat-session',
      projectId: 'project-1',
      sessionId: 'session-1',
      issueId: null,
    })
    expect(binding.reason).toContain('custom-profile:preferred:preferred-1')
  })

  it('falls back to source default when policy=custom-profile without preferredProfileId', async () => {
    const service = new BrowserService({
      dispatch: vi.fn() as never,
      store: {} as never,
    })
    const findOrCreateProfileByNameSpy = vi.fn().mockResolvedValue('profile-project-1')
    ;(
      service as unknown as {
        findOrCreateProfileByName: (name: string) => Promise<string>
      }
    ).findOrCreateProfileByName = findOrCreateProfileByNameSpy

    const binding = await service.resolveStateBinding({
      source: { type: 'chat-session', sessionId: 'session-1' },
      policy: 'custom-profile',
      projectId: 'project-1',
    })

    expect(findOrCreateProfileByNameSpy).toHaveBeenCalledWith('State:global')
    expect(binding).toMatchObject({
      policy: 'shared-global',
      profileId: 'profile-project-1',
      sourceType: 'chat-session',
      projectId: 'project-1',
      sessionId: 'session-1',
      issueId: null,
    })
    expect(binding.reason).toContain('policy:custom-profile-missing-preferred:fallback:shared-global:global')
  })

  it('uses source default policy shared-global for standalone source', async () => {
    const service = new BrowserService({
      dispatch: vi.fn() as never,
      store: {} as never,
    })
    const findOrCreateProfileByNameSpy = vi.fn().mockResolvedValue('profile-global')
    ;(
      service as unknown as {
        findOrCreateProfileByName: (name: string) => Promise<string>
      }
    ).findOrCreateProfileByName = findOrCreateProfileByNameSpy

    const binding = await service.resolveStateBinding({
      source: { type: 'standalone' },
    })

    expect(findOrCreateProfileByNameSpy).toHaveBeenCalledWith('State:global')
    expect(binding).toMatchObject({
      policy: 'shared-global',
      profileId: 'profile-global',
      sourceType: 'standalone',
      projectId: null,
      issueId: null,
      sessionId: null,
    })
    expect(binding.reason).toContain('policy:shared-global:global')
  })

  it('degrades shared-project to shared-global when projectId is missing', async () => {
    const service = new BrowserService({
      dispatch: vi.fn() as never,
      store: {} as never,
    })
    const findOrCreateProfileByNameSpy = vi.fn().mockResolvedValue('profile-global')
    ;(
      service as unknown as {
        findOrCreateProfileByName: (name: string) => Promise<string>
      }
    ).findOrCreateProfileByName = findOrCreateProfileByNameSpy

    const binding = await service.resolveStateBinding({
      source: { type: 'chat-session', sessionId: 'session-1' },
      policy: 'shared-project',
    })

    expect(findOrCreateProfileByNameSpy).toHaveBeenCalledWith('State:global')
    expect(binding).toMatchObject({
      policy: 'shared-global',
      profileId: 'profile-global',
      sourceType: 'chat-session',
      projectId: null,
      sessionId: 'session-1',
      issueId: null,
    })
    expect(binding.reason).toContain('policy:shared-global:global')
  })

  it('degrades isolated-issue to isolated-session when issueId is missing', async () => {
    const service = new BrowserService({
      dispatch: vi.fn() as never,
      store: {} as never,
    })
    const findOrCreateProfileByNameSpy = vi.fn().mockResolvedValue('profile-session-1')
    ;(
      service as unknown as {
        findOrCreateProfileByName: (name: string) => Promise<string>
      }
    ).findOrCreateProfileByName = findOrCreateProfileByNameSpy

    const binding = await service.resolveStateBinding({
      source: { type: 'chat-session', sessionId: 'session-1' },
      policy: 'isolated-issue',
      projectId: 'project-1',
    })

    expect(findOrCreateProfileByNameSpy).toHaveBeenCalledWith('State:session:session-1')
    expect(binding).toMatchObject({
      policy: 'isolated-session',
      profileId: 'profile-session-1',
      sourceType: 'chat-session',
      projectId: 'project-1',
      sessionId: 'session-1',
      issueId: null,
    })
    expect(binding.reason).toContain('policy:isolated-session:session:session-1')
  })

  it('resolves isolated-session policy scope by session id', async () => {
    const service = new BrowserService({
      dispatch: vi.fn() as never,
      store: {} as never,
    })
    const findOrCreateProfileByNameSpy = vi.fn().mockResolvedValue('profile-session-1')
    ;(
      service as unknown as {
        findOrCreateProfileByName: (name: string) => Promise<string>
      }
    ).findOrCreateProfileByName = findOrCreateProfileByNameSpy

    const binding = await service.resolveStateBinding({
      source: { type: 'issue-session', issueId: 'issue-1', sessionId: 'session-1' },
      policy: 'isolated-session',
      projectId: 'project-1',
    })

    expect(findOrCreateProfileByNameSpy).toHaveBeenCalledWith('State:session:session-1')
    expect(binding).toMatchObject({
      policy: 'isolated-session',
      profileId: 'profile-session-1',
      sourceType: 'issue-session',
      projectId: 'project-1',
      issueId: 'issue-1',
      sessionId: 'session-1',
    })
    expect(binding.reason).toContain('policy:isolated-session:session:session-1')
  })
})
