// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ContextRefResolver } from '../../../electron/services/contextRefResolver'
import type { ContextRefResolverDeps } from '../../../electron/services/contextRefResolver'
import type { ContextRef } from '../../../src/shared/types'

// ─── Mock factories ─────────────────────────────────────────────────

function makeDeps(overrides?: Partial<ContextRefResolverDeps>): ContextRefResolverDeps {
  return {
    contextRefStore: {
      listByIssueId: vi.fn().mockResolvedValue([]),
      replaceAll: vi.fn(),
      deleteByRef: vi.fn(),
    } as any,
    issueService: {
      getIssue: vi.fn().mockResolvedValue(null),
    } as any,
    artifactService: {
      list: vi.fn().mockResolvedValue([]),
    } as any,
    ...overrides,
  }
}

function issueRef(id: string): ContextRef {
  return { type: 'issue', id }
}

function artifactRef(id: string): ContextRef {
  return { type: 'artifact', id }
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('ContextRefResolver (Manifest mode)', () => {
  let deps: ContextRefResolverDeps
  let resolver: ContextRefResolver

  beforeEach(() => {
    deps = makeDeps()
    resolver = new ContextRefResolver(deps)
  })

  // ── No refs ───────────────────────────────────────────────────────

  it('returns undefined when issue has no contextRefs', async () => {
    vi.mocked(deps.contextRefStore.listByIssueId).mockResolvedValue([])

    const result = await resolver.resolveForIssue('issue-1')

    expect(result).toBeUndefined()
    expect(deps.contextRefStore.listByIssueId).toHaveBeenCalledWith('issue-1')
  })

  // ── Issue refs ────────────────────────────────────────────────────

  it('resolves a single issue ref with metadata (no content injection)', async () => {
    vi.mocked(deps.contextRefStore.listByIssueId).mockResolvedValue([issueRef('ref-issue-1')])
    vi.mocked(deps.issueService.getIssue).mockResolvedValue({
      id: 'ref-issue-1',
      title: 'Fix login bug',
      status: 'todo',
      sessionId: null,
    } as any)

    const result = await resolver.resolveForIssue('issue-1')

    expect(result).toBeDefined()
    expect(result).toContain('<context-references>')
    expect(result).toContain('</context-references>')
    // Manifest format: numbered entry with type label
    expect(result).toContain('[Issue] "Fix login bug"')
    expect(result).toContain('ID: ref-issue-1')
    expect(result).toContain('status: todo')
    expect(result).toContain('Use get_issue to read full details')
    // Should NOT contain full content — manifest is metadata-only
    expect(result).not.toContain('Users cannot log in')
  })

  it('shows session hint when issue has a session', async () => {
    vi.mocked(deps.contextRefStore.listByIssueId).mockResolvedValue([issueRef('ref-issue-2')])
    vi.mocked(deps.issueService.getIssue).mockResolvedValue({
      id: 'ref-issue-2',
      title: 'Task with session',
      status: 'in_progress',
      sessionId: 'session-abc',
    } as any)

    const result = await resolver.resolveForIssue('issue-1')

    expect(result).toContain('[Issue] "Task with session"')
    expect(result).toContain('status: in_progress')
    expect(result).toContain('Has session history')
    expect(result).toContain('prior session context')
  })

  it('shows basic hint when issue has no session', async () => {
    vi.mocked(deps.contextRefStore.listByIssueId).mockResolvedValue([issueRef('ref-issue-3')])
    vi.mocked(deps.issueService.getIssue).mockResolvedValue({
      id: 'ref-issue-3',
      title: 'No session issue',
      status: 'backlog',
      sessionId: null,
    } as any)

    const result = await resolver.resolveForIssue('issue-1')

    expect(result).toContain('Use get_issue to read full details')
    expect(result).not.toContain('session history')
  })

  // ── Artifact refs ─────────────────────────────────────────────────

  it('resolves an artifact ref with metadata and file path hint', async () => {
    vi.mocked(deps.contextRefStore.listByIssueId).mockResolvedValue([artifactRef('art-1')])
    vi.mocked(deps.artifactService!.list).mockResolvedValue([
      {
        id: 'art-1',
        title: 'design-spec.md',
        filePath: '/docs/design-spec.md',
        mimeType: 'text/markdown',
        contentLength: 4096,
      } as any,
    ])

    const result = await resolver.resolveForIssue('issue-1')

    expect(result).toBeDefined()
    expect(result).toContain('[Artifact] "design-spec.md"')
    expect(result).toContain('ID: art-1')
    expect(result).toContain('text/markdown')
    expect(result).toContain('Size: 4096 bytes')
    expect(result).toContain('Read file: /docs/design-spec.md')
    // Should NOT contain actual file content
    expect(result).not.toContain('# Design Spec')
  })

  it('suggests tool access when artifact has no filePath', async () => {
    vi.mocked(deps.contextRefStore.listByIssueId).mockResolvedValue([artifactRef('art-2')])
    vi.mocked(deps.artifactService!.list).mockResolvedValue([
      {
        id: 'art-2',
        title: 'api-docs.md',
        filePath: null,
        mimeType: 'text/markdown',
        contentLength: 2048,
      } as any,
    ])

    const result = await resolver.resolveForIssue('issue-1')

    expect(result).toContain('[Artifact] "api-docs.md"')
    expect(result).toContain('Use get-artifact-content tool to read content')
    expect(result).not.toContain('Read file:')
  })

  it('uses filePath as title fallback when title is empty', async () => {
    vi.mocked(deps.contextRefStore.listByIssueId).mockResolvedValue([artifactRef('art-3')])
    vi.mocked(deps.artifactService!.list).mockResolvedValue([
      {
        id: 'art-3',
        title: '',
        filePath: '/src/utils/helpers.ts',
        mimeType: 'text/typescript',
        contentLength: 512,
      } as any,
    ])

    const result = await resolver.resolveForIssue('issue-1')

    expect(result).toContain('[Artifact] "/src/utils/helpers.ts"')
  })

  it('uses id as title fallback when both title and filePath are empty', async () => {
    vi.mocked(deps.contextRefStore.listByIssueId).mockResolvedValue([artifactRef('art-4')])
    vi.mocked(deps.artifactService!.list).mockResolvedValue([
      {
        id: 'art-4',
        title: '',
        filePath: '',
        mimeType: 'application/octet-stream',
        contentLength: 100,
      } as any,
    ])

    const result = await resolver.resolveForIssue('issue-1')

    expect(result).toContain('[Artifact] "art-4"')
  })

  // ── Mixed refs ────────────────────────────────────────────────────

  it('resolves mixed issue + artifact refs with correct numbering', async () => {
    vi.mocked(deps.contextRefStore.listByIssueId).mockResolvedValue([
      issueRef('ref-issue-1'),
      artifactRef('art-1'),
    ])
    vi.mocked(deps.issueService.getIssue).mockResolvedValue({
      id: 'ref-issue-1',
      title: 'Related task',
      status: 'done',
      sessionId: 'session-xyz',
    } as any)
    vi.mocked(deps.artifactService!.list).mockResolvedValue([
      {
        id: 'art-1',
        title: 'spec.md',
        filePath: '/docs/spec.md',
        mimeType: 'text/markdown',
        contentLength: 3000,
      } as any,
    ])

    const result = await resolver.resolveForIssue('issue-1')

    // Both refs present with correct type labels
    expect(result).toContain('1. [Issue] "Related task"')
    expect(result).toContain('2. [Artifact] "spec.md"')
    // Issue metadata
    expect(result).toContain('status: done')
    expect(result).toContain('Has session history')
    // Artifact metadata
    expect(result).toContain('text/markdown')
    expect(result).toContain('Size: 3000 bytes')
    expect(result).toContain('Read file: /docs/spec.md')
  })

  // ── Error handling / graceful degradation ─────────────────────────

  it('skips deleted issue refs without crashing', async () => {
    vi.mocked(deps.contextRefStore.listByIssueId).mockResolvedValue([
      issueRef('deleted-issue'),
      issueRef('valid-issue'),
    ])
    vi.mocked(deps.issueService.getIssue).mockImplementation(async (id) => {
      if (id === 'valid-issue') {
        return { id, title: 'Valid', status: 'todo', sessionId: null } as any
      }
      return null // deleted
    })

    const result = await resolver.resolveForIssue('issue-1')

    expect(result).toContain('[Issue] "Valid"')
    expect(result).not.toContain('deleted-issue')
  })

  it('returns undefined when all refs fail to resolve', async () => {
    vi.mocked(deps.contextRefStore.listByIssueId).mockResolvedValue([
      issueRef('gone-1'),
      issueRef('gone-2'),
    ])
    vi.mocked(deps.issueService.getIssue).mockResolvedValue(null)

    const result = await resolver.resolveForIssue('issue-1')

    expect(result).toBeUndefined()
  })

  it('skips artifact refs when artifactService is null', async () => {
    const depsNoArtifact = makeDeps({ artifactService: null })
    const resolverNoArtifact = new ContextRefResolver(depsNoArtifact)

    vi.mocked(depsNoArtifact.contextRefStore.listByIssueId).mockResolvedValue([
      artifactRef('art-1'),
      issueRef('ref-issue-1'),
    ])
    vi.mocked(depsNoArtifact.issueService.getIssue).mockResolvedValue({
      id: 'ref-issue-1',
      title: 'Fallback issue',
      status: 'todo',
      sessionId: null,
    } as any)

    const result = await resolverNoArtifact.resolveForIssue('issue-1')

    expect(result).toContain('[Issue] "Fallback issue"')
    expect(result).not.toContain('[Artifact]')
  })

  it('handles service errors gracefully per ref', async () => {
    vi.mocked(deps.contextRefStore.listByIssueId).mockResolvedValue([
      issueRef('error-issue'),
      issueRef('ok-issue'),
    ])
    vi.mocked(deps.issueService.getIssue).mockImplementation(async (id) => {
      if (id === 'error-issue') throw new Error('DB connection lost')
      return { id, title: 'OK Issue', status: 'todo', sessionId: null } as any
    })

    const result = await resolver.resolveForIssue('issue-1')

    expect(result).toContain('[Issue] "OK Issue"')
    expect(result).not.toContain('error-issue')
  })

  // ── Output format ─────────────────────────────────────────────────

  it('wraps output in <context-references> tags with manifest intro', async () => {
    vi.mocked(deps.contextRefStore.listByIssueId).mockResolvedValue([issueRef('ref-1')])
    vi.mocked(deps.issueService.getIssue).mockResolvedValue({
      id: 'ref-1',
      title: 'Test',
      status: 'todo',
      sessionId: null,
    } as any)

    const result = await resolver.resolveForIssue('issue-1')

    const lines = result!.split('\n')
    expect(lines[0]).toBe('<context-references>')
    expect(lines[1]).toBe('This issue has the following items attached as context.')
    expect(lines[2]).toContain('SHOULD read them before starting work')
    expect(lines[lines.length - 1]).toBe('</context-references>')
  })

  it('does not include sizeHint line for issue entries', async () => {
    vi.mocked(deps.contextRefStore.listByIssueId).mockResolvedValue([issueRef('ref-1')])
    vi.mocked(deps.issueService.getIssue).mockResolvedValue({
      id: 'ref-1',
      title: 'No size',
      status: 'todo',
      sessionId: null,
    } as any)

    const result = await resolver.resolveForIssue('issue-1')

    expect(result).not.toContain('Size:')
  })
})
