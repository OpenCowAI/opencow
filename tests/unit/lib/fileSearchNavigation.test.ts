// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FilesQuickSearchItem } from '../../../src/renderer/hooks/useFilesQuickSearch'
import {
  buildFileSearchNavigationCommand,
  createFileSearchNavigationExecutor,
  resolveFileSearchActionLabels,
  type FileSearchNavigationDependencies,
  type FileSearchNavigationTarget,
} from '../../../src/renderer/lib/fileSearchNavigation'

function createItem(overrides: Partial<FilesQuickSearchItem> = {}): FilesQuickSearchItem {
  return {
    path: 'src/main.ts',
    name: 'main.ts',
    isDirectory: false,
    score: 100,
    nameHighlights: [],
    pathHighlights: [],
    source: 'search',
    ...overrides,
  }
}

function setup() {
  const readers = {
    readFileContent: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        content: 'console.log("ok")',
        language: 'typescript',
        size: 18,
      },
    }),
    readImagePreview: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        dataUrl: 'data:image/png;base64,abc',
        mimeType: 'image/png',
        size: 3,
      },
    }),
  }
  const writers = {
    openFile: vi.fn(),
    enqueueEditorJumpIntent: vi.fn(),
    enqueueTreeRevealIntent: vi.fn(),
  }
  const deps: FileSearchNavigationDependencies = {
    project: {
      id: 'proj-1',
      path: '/tmp/proj-1',
    },
    readers,
    writers,
  }
  const executor = createFileSearchNavigationExecutor(deps)
  return { executor, readers, writers }
}

describe('fileSearchNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('open-current reveals directory in tree', async () => {
    const { executor, writers } = setup()

    await executor.execute({
      kind: 'open-current',
      target: createItem({ isDirectory: true, path: 'src/components', name: 'components' }),
      options: { line: null },
    })

    expect(writers.enqueueTreeRevealIntent).toHaveBeenCalledWith('proj-1', { path: 'src/components' })
  })

  it('open-current routes file to editor with optional line jump', async () => {
    const { executor, readers, writers } = setup()

    await executor.execute({
      kind: 'open-current',
      target: createItem({ path: 'src/main.ts', name: 'main.ts' }),
      options: { line: 23 },
    })

    expect(readers.readFileContent).toHaveBeenCalledWith('/tmp/proj-1', 'src/main.ts')
    expect(writers.openFile).toHaveBeenCalledWith({
      path: 'src/main.ts',
      name: 'main.ts',
      language: 'typescript',
      content: 'console.log("ok")',
      viewKind: 'text',
      imageDataUrl: null,
    })
    expect(writers.enqueueEditorJumpIntent).toHaveBeenCalledWith('proj-1', {
      path: 'src/main.ts',
      line: 23,
    })
  })

  it('open-editor opens image file in editor image mode', async () => {
    const { executor, readers, writers } = setup()

    await executor.execute({
      kind: 'open-editor',
      target: createItem({ path: 'assets/logo.png', name: 'logo.png' }),
      options: { line: null },
    })

    expect(readers.readImagePreview).toHaveBeenCalledWith('/tmp/proj-1', 'assets/logo.png')
    expect(writers.openFile).toHaveBeenCalledWith({
      path: 'assets/logo.png',
      name: 'logo.png',
      language: 'image/png',
      content: '',
      viewKind: 'image',
      imageDataUrl: 'data:image/png;base64,abc',
    })
    expect(writers.enqueueEditorJumpIntent).not.toHaveBeenCalled()
  })

  it('open-editor on directory reveals tree node', async () => {
    const { executor, readers, writers } = setup()

    await executor.execute({
      kind: 'open-editor',
      target: createItem({ isDirectory: true, path: 'src/lib', name: 'lib' }),
      options: { line: null },
    })

    expect(writers.enqueueTreeRevealIntent).toHaveBeenCalledWith('proj-1', { path: 'src/lib' })
    expect(readers.readFileContent).not.toHaveBeenCalled()
    expect(readers.readImagePreview).not.toHaveBeenCalled()
  })

  it('reveal command enqueues tree reveal', async () => {
    const { executor, writers } = setup()

    await executor.execute({
      kind: 'reveal',
      target: createItem({ path: 'src/app/main.ts', name: 'main.ts' }),
    })

    expect(writers.enqueueTreeRevealIntent).toHaveBeenCalledWith('proj-1', { path: 'src/app/main.ts' })
  })

  it('builds commands from overlay actions with unified mapping', () => {
    const target: FileSearchNavigationTarget = {
      path: 'src/main.ts',
      name: 'main.ts',
      isDirectory: false,
    }

    expect(buildFileSearchNavigationCommand({
      action: 'current',
      target,
      line: 12,
    })).toEqual({
      kind: 'open-current',
      target,
      options: { line: 12 },
    })

    expect(buildFileSearchNavigationCommand({
      action: 'editor',
      target,
      line: null,
    })).toEqual({
      kind: 'open-editor',
      target,
      options: { line: null },
    })

    expect(buildFileSearchNavigationCommand({
      action: 'reveal',
      target,
      line: null,
    })).toEqual({
      kind: 'reveal',
      target,
    })
  })

  it('resolves action labels from same navigation semantics', () => {
    expect(resolveFileSearchActionLabels({ path: 'src/main.ts', name: 'main.ts', isDirectory: false })).toEqual({
      current: 'open',
      editor: 'openInEditor',
      reveal: 'reveal',
    })

    expect(resolveFileSearchActionLabels({ path: 'src', name: 'src', isDirectory: true })).toEqual({
      current: 'revealInTree',
      editor: 'revealInTree',
      reveal: 'revealParent',
    })
  })
})
