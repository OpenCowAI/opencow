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
    setFilesDisplayMode: vi.fn(),
    setBrowserSubPath: vi.fn(),
    setBrowserExternalOpenPath: vi.fn(),
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

  it('open-current in browser mode opens directory directly', async () => {
    const { executor, writers } = setup()

    await executor.execute({
      kind: 'open-current',
      target: createItem({ isDirectory: true, path: 'src', name: 'src' }),
      context: { mode: 'browser' },
      options: { line: null },
    })

    expect(writers.setBrowserSubPath).toHaveBeenCalledWith('proj-1', 'src')
    expect(writers.setBrowserExternalOpenPath).toHaveBeenCalledWith(null)
    expect(writers.enqueueTreeRevealIntent).not.toHaveBeenCalled()
  })

  it('open-current in ide mode reveals directory in tree', async () => {
    const { executor, writers } = setup()

    await executor.execute({
      kind: 'open-current',
      target: createItem({ isDirectory: true, path: 'src/components', name: 'components' }),
      context: { mode: 'ide' },
      options: { line: null },
    })

    expect(writers.enqueueTreeRevealIntent).toHaveBeenCalledWith('proj-1', { path: 'src/components' })
    expect(writers.setBrowserSubPath).not.toHaveBeenCalled()
  })

  it('open-current routes to editor when :line is provided in browser mode', async () => {
    const { executor, readers, writers } = setup()

    await executor.execute({
      kind: 'open-current',
      target: createItem({ path: 'src/main.ts', name: 'main.ts' }),
      context: { mode: 'browser' },
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
    expect(writers.setFilesDisplayMode).toHaveBeenCalledWith('proj-1', 'ide')
    expect(writers.enqueueEditorJumpIntent).toHaveBeenCalledWith('proj-1', {
      path: 'src/main.ts',
      line: 23,
    })
    expect(writers.setBrowserExternalOpenPath).not.toHaveBeenCalledWith('src/main.ts')
  })

  it('open-current in browser mode opens file preview by parent path + external open', async () => {
    const { executor, writers, readers } = setup()

    await executor.execute({
      kind: 'open-current',
      target: createItem({ path: 'src/main.ts', name: 'main.ts' }),
      context: { mode: 'browser' },
      options: { line: null },
    })

    expect(writers.setBrowserSubPath).toHaveBeenCalledWith('proj-1', 'src')
    expect(writers.setBrowserExternalOpenPath).toHaveBeenCalledWith('src/main.ts')
    expect(readers.readFileContent).not.toHaveBeenCalled()
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
    expect(writers.setFilesDisplayMode).toHaveBeenCalledWith('proj-1', 'ide')
    expect(writers.enqueueEditorJumpIntent).not.toHaveBeenCalled()
  })

  it('open-editor on directory reveals tree node in ide mode', async () => {
    const { executor, readers, writers } = setup()

    await executor.execute({
      kind: 'open-editor',
      target: createItem({ isDirectory: true, path: 'src/lib', name: 'lib' }),
      options: { line: null },
    })

    expect(writers.setFilesDisplayMode).toHaveBeenCalledWith('proj-1', 'ide')
    expect(writers.enqueueTreeRevealIntent).toHaveBeenCalledWith('proj-1', { path: 'src/lib' })
    expect(readers.readFileContent).not.toHaveBeenCalled()
    expect(readers.readImagePreview).not.toHaveBeenCalled()
  })

  it('reveal command in browser mode repositions browser and clears external open target', async () => {
    const { executor, writers } = setup()

    await executor.execute({
      kind: 'reveal',
      target: createItem({ path: 'src/app/main.ts', name: 'main.ts' }),
      context: { mode: 'browser' },
    })

    expect(writers.setBrowserSubPath).toHaveBeenCalledWith('proj-1', 'src/app')
    expect(writers.setBrowserExternalOpenPath).toHaveBeenCalledWith(null)
    expect(writers.enqueueTreeRevealIntent).not.toHaveBeenCalled()
  })

  it('reveal command in ide mode only enqueues tree reveal', async () => {
    const { executor, writers } = setup()

    await executor.execute({
      kind: 'reveal',
      target: createItem({ path: 'src/app/main.ts', name: 'main.ts' }),
      context: { mode: 'ide' },
    })

    expect(writers.enqueueTreeRevealIntent).toHaveBeenCalledWith('proj-1', { path: 'src/app/main.ts' })
    expect(writers.setBrowserSubPath).not.toHaveBeenCalled()
    expect(writers.setBrowserExternalOpenPath).not.toHaveBeenCalled()
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
      mode: 'browser',
      line: 12,
    })).toEqual({
      kind: 'open-current',
      target,
      context: { mode: 'browser' },
      options: { line: 12 },
    })

    expect(buildFileSearchNavigationCommand({
      action: 'editor',
      target,
      mode: 'ide',
      line: null,
    })).toEqual({
      kind: 'open-editor',
      target,
      options: { line: null },
    })

    expect(buildFileSearchNavigationCommand({
      action: 'reveal',
      target,
      mode: 'ide',
      line: null,
    })).toEqual({
      kind: 'reveal',
      target,
      context: { mode: 'ide' },
    })
  })

  it('resolves action labels from same navigation semantics', () => {
    expect(resolveFileSearchActionLabels({ path: 'src/main.ts', name: 'main.ts', isDirectory: false }, 'ide')).toEqual({
      current: 'open',
      editor: 'openInEditor',
      reveal: 'reveal',
    })

    expect(resolveFileSearchActionLabels({ path: 'src', name: 'src', isDirectory: true }, 'browser')).toEqual({
      current: 'openFolder',
      editor: 'revealInTree',
      reveal: 'revealParent',
    })

    expect(resolveFileSearchActionLabels({ path: 'src', name: 'src', isDirectory: true }, 'ide')).toEqual({
      current: 'revealInTree',
      editor: 'revealInTree',
      reveal: 'revealParent',
    })
  })
})
