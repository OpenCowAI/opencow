// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from 'vitest'
import { useFileStore } from '../../../src/renderer/stores/fileStore'

const PROJECT_A = 'project-a'
const PROJECT_B = 'project-b'

function openText(projectId: string, path: string, content = ''): void {
  useFileStore.getState().openFile(projectId, {
    path,
    name: path.split('/').at(-1) ?? path,
    language: 'typescript',
    content,
    viewKind: 'text',
    imageDataUrl: null,
  })
}

describe('fileStore', () => {
  beforeEach(() => {
    useFileStore.getState().reset()
  })

  it('initial state is empty', () => {
    const state = useFileStore.getState()
    expect(state.openFilesByProject).toEqual({})
    expect(state.activeFilePathByProject).toEqual({})
    expect(state.expandedTreeDirsByProject).toEqual({})
    expect(state.pendingFileWritesByToolId).toEqual({})
    expect(state.pendingFileRefreshPathsByProject).toEqual({})
  })

  it('opens a file and sets it active for the project', () => {
    openText(PROJECT_A, 'src/App.tsx', 'export function App() {}')

    const state = useFileStore.getState()
    expect(state.openFilesByProject[PROJECT_A]).toHaveLength(1)
    expect(state.openFilesByProject[PROJECT_A]?.[0].path).toBe('src/App.tsx')
    expect(state.openFilesByProject[PROJECT_A]?.[0].isDirty).toBe(false)
    expect(state.activeFilePathByProject[PROJECT_A]).toBe('src/App.tsx')
  })

  it('does not duplicate already-open files in same project', () => {
    openText(PROJECT_A, 'src/App.tsx', 'content')
    openText(PROJECT_A, 'src/App.tsx', 'content')

    expect(useFileStore.getState().openFilesByProject[PROJECT_A]).toHaveLength(1)
    expect(useFileStore.getState().activeFilePathByProject[PROJECT_A]).toBe('src/App.tsx')
  })

  it('allows same file path opened in different projects without leaking state', () => {
    openText(PROJECT_A, 'src/shared.ts', 'a')
    openText(PROJECT_B, 'src/shared.ts', 'b')

    const state = useFileStore.getState()
    expect(state.openFilesByProject[PROJECT_A]?.[0].content).toBe('a')
    expect(state.openFilesByProject[PROJECT_B]?.[0].content).toBe('b')
    expect(state.activeFilePathByProject[PROJECT_A]).toBe('src/shared.ts')
    expect(state.activeFilePathByProject[PROJECT_B]).toBe('src/shared.ts')
  })

  it('closes a file and activates neighbor within same project', () => {
    openText(PROJECT_A, 'a.ts')
    openText(PROJECT_A, 'b.ts')

    useFileStore.getState().closeFile(PROJECT_A, 'b.ts')
    const state = useFileStore.getState()
    expect(state.openFilesByProject[PROJECT_A]).toHaveLength(1)
    expect(state.activeFilePathByProject[PROJECT_A]).toBe('a.ts')
  })

  it('setActiveFile only affects the specified project', () => {
    openText(PROJECT_A, 'a.ts')
    openText(PROJECT_A, 'b.ts')
    openText(PROJECT_B, 'x.ts')

    useFileStore.getState().setActiveFile(PROJECT_A, 'a.ts')
    expect(useFileStore.getState().activeFilePathByProject[PROJECT_A]).toBe('a.ts')
    expect(useFileStore.getState().activeFilePathByProject[PROJECT_B]).toBe('x.ts')
  })

  it('marks text file dirty on content change', () => {
    openText(PROJECT_A, 'a.ts', 'original')

    useFileStore.getState().updateFileContent(PROJECT_A, 'a.ts', 'modified')
    const file = useFileStore.getState().openFilesByProject[PROJECT_A]?.[0]
    expect(file?.content).toBe('modified')
    expect(file?.isDirty).toBe(true)
  })

  it('does not mark image file dirty on content update', () => {
    useFileStore.getState().openFile(PROJECT_A, {
      path: 'assets/logo.png',
      name: 'logo.png',
      language: 'image/png',
      content: '',
      viewKind: 'image',
      imageDataUrl: 'data:image/png;base64,abc',
    })

    useFileStore.getState().updateFileContent(PROJECT_A, 'assets/logo.png', 'should-not-apply')
    const file = useFileStore.getState().openFilesByProject[PROJECT_A]?.[0]
    expect(file?.content).toBe('')
    expect(file?.isDirty).toBe(false)
  })

  it('marks file clean on save', () => {
    openText(PROJECT_A, 'a.ts', 'original')
    useFileStore.getState().updateFileContent(PROJECT_A, 'a.ts', 'modified')
    useFileStore.getState().markFileSaved(PROJECT_A, 'a.ts')

    const file = useFileStore.getState().openFilesByProject[PROJECT_A]?.[0]
    expect(file?.isDirty).toBe(false)
    expect(file?.savedContent).toBe('modified')
  })

  it('toggles directory expanded state', () => {
    const store = useFileStore.getState()
    store.toggleTreeDir(PROJECT_A, 'src')
    expect(useFileStore.getState().expandedTreeDirsByProject[PROJECT_A]?.has('src')).toBe(true)

    store.toggleTreeDir(PROJECT_A, 'src')
    expect(useFileStore.getState().expandedTreeDirsByProject[PROJECT_A]?.has('src')).toBe(false)
  })

  it('collapsing parent directory clears expanded state of descendants', () => {
    const store = useFileStore.getState()
    store.toggleTreeDir(PROJECT_A, 'src')
    store.toggleTreeDir(PROJECT_A, 'src/components')
    store.toggleTreeDir(PROJECT_A, 'src/components/ui')

    expect(useFileStore.getState().expandedTreeDirsByProject[PROJECT_A]).toEqual(
      new Set(['src', 'src/components', 'src/components/ui'])
    )

    store.toggleTreeDir(PROJECT_A, 'src')
    expect(useFileStore.getState().expandedTreeDirsByProject[PROJECT_A]).toEqual(new Set())

    store.toggleTreeDir(PROJECT_A, 'src')
    expect(useFileStore.getState().expandedTreeDirsByProject[PROJECT_A]).toEqual(new Set(['src']))
    expect(useFileStore.getState().expandedTreeDirsByProject[PROJECT_A]?.has('src/components')).toBe(false)
    expect(useFileStore.getState().expandedTreeDirsByProject[PROJECT_A]?.has('src/components/ui')).toBe(false)
  })

  it('stores browser sub-path per project and supports clearing', () => {
    const store = useFileStore.getState()
    store.setBrowserSubPath(PROJECT_A, 'src/components')
    store.setBrowserSubPath(PROJECT_B, 'docs')

    expect(useFileStore.getState().browserSubPathByProject).toEqual({
      [PROJECT_A]: 'src/components',
      [PROJECT_B]: 'docs',
    })

    store.clearBrowserSubPath(PROJECT_A)
    expect(useFileStore.getState().browserSubPathByProject).toEqual({
      [PROJECT_B]: 'docs',
    })
  })

  it('stores and consumes pending refresh paths per project', () => {
    useFileStore.getState().markFileNeedsRefresh(PROJECT_A, '/src/a.ts')
    useFileStore.getState().markFileNeedsRefresh(PROJECT_A, '/src/b.ts')
    useFileStore.getState().markFileNeedsRefresh(PROJECT_A, '/src/a.ts')
    useFileStore.getState().markFileNeedsRefresh(PROJECT_B, '/src/other.ts')

    expect(useFileStore.getState().pendingFileRefreshPathsByProject[PROJECT_A]).toEqual(['/src/a.ts', '/src/b.ts'])
    expect(useFileStore.getState().pendingFileRefreshPathsByProject[PROJECT_B]).toEqual(['/src/other.ts'])

    const consumedA = useFileStore.getState().consumePendingFileRefresh(PROJECT_A)
    expect(consumedA).toEqual(['/src/a.ts', '/src/b.ts'])
    expect(useFileStore.getState().pendingFileRefreshPathsByProject[PROJECT_A]).toEqual([])
    expect(useFileStore.getState().pendingFileRefreshPathsByProject[PROJECT_B]).toEqual(['/src/other.ts'])
  })

  it('markAllOpenFilesNeedRefresh only includes non-dirty text files in target project', () => {
    openText(PROJECT_A, 'a.ts', 'a')
    openText(PROJECT_A, 'b.ts', 'b')
    useFileStore.getState().updateFileContent(PROJECT_A, 'b.ts', 'dirty-b')

    openText(PROJECT_B, 'x.ts', 'x')

    useFileStore.getState().markAllOpenFilesNeedRefresh(PROJECT_A)
    expect(useFileStore.getState().pendingFileRefreshPathsByProject[PROJECT_A]).toEqual(['a.ts'])
    expect(useFileStore.getState().pendingFileRefreshPathsByProject[PROJECT_B]).toBeUndefined()
  })

  it('tracks pending file write with project scope and resolves atomically', () => {
    useFileStore.getState().trackPendingFileWrite('tool-1', '/src/file.ts', PROJECT_A)

    expect(useFileStore.getState().pendingFileWritesByToolId['tool-1']).toEqual({
      path: '/src/file.ts',
      projectId: PROJECT_A,
    })

    const result = useFileStore.getState().resolvePendingFileWrite('tool-1')
    expect(result).toEqual({ path: '/src/file.ts', projectId: PROJECT_A })
    expect(useFileStore.getState().pendingFileWritesByToolId['tool-1']).toBeUndefined()
  })

  it('reset() restores initial state', () => {
    openText(PROJECT_A, 'a.ts')
    useFileStore.getState().toggleTreeDir(PROJECT_A, 'src')
    useFileStore.getState().trackPendingFileWrite('tool-1', '/src/a.ts', PROJECT_A)
    useFileStore.getState().markFileNeedsRefresh(PROJECT_A, '/src/a.ts')

    useFileStore.getState().reset()

    const state = useFileStore.getState()
    expect(state.openFilesByProject).toEqual({})
    expect(state.activeFilePathByProject).toEqual({})
    expect(state.expandedTreeDirsByProject).toEqual({})
    expect(state.browserSubPathByProject).toEqual({})
    expect(state.fileSearchQueryByProject).toEqual({})
    expect(state.recentFileSearchSelectionsByProject).toEqual({})
    expect(state.pendingEditorJumpIntentsByProject).toEqual({})
    expect(state.pendingTreeRevealIntentsByProject).toEqual({})
    expect(state.pendingFileWritesByToolId).toEqual({})
    expect(state.pendingFileRefreshPathsByProject).toEqual({})
  })
})

describe('fileStore - refreshFile', () => {
  beforeEach(() => {
    useFileStore.getState().reset()
  })

  it('refreshFile updates content for non-dirty open file', () => {
    openText(PROJECT_A, 'a.ts', 'old')

    useFileStore.getState().refreshFile(PROJECT_A, { path: 'a.ts', content: 'new', language: 'typescript' })
    const file = useFileStore.getState().openFilesByProject[PROJECT_A]?.[0]
    expect(file?.content).toBe('new')
    expect(file?.savedContent).toBe('new')
    expect(file?.isDirty).toBe(false)
  })

  it('refreshFile skips dirty files', () => {
    openText(PROJECT_A, 'a.ts', 'original')
    useFileStore.getState().updateFileContent(PROJECT_A, 'a.ts', 'user-edit')

    useFileStore.getState().refreshFile(PROJECT_A, { path: 'a.ts', content: 'from-disk', language: 'typescript' })
    const file = useFileStore.getState().openFilesByProject[PROJECT_A]?.[0]
    expect(file?.content).toBe('user-edit')
    expect(file?.isDirty).toBe(true)
  })

  it('refreshFile no-ops when content is same (keeps same array ref)', () => {
    openText(PROJECT_A, 'a.ts', 'same')

    const before = useFileStore.getState().openFilesByProject[PROJECT_A]
    useFileStore.getState().refreshFile(PROJECT_A, { path: 'a.ts', content: 'same', language: 'typescript' })
    const after = useFileStore.getState().openFilesByProject[PROJECT_A]
    expect(before).toBe(after)
  })

  it('refreshFile skips image files', () => {
    useFileStore.getState().openFile(PROJECT_A, {
      path: 'assets/logo.png',
      name: 'logo.png',
      language: 'image/png',
      content: '',
      viewKind: 'image',
      imageDataUrl: 'data:image/png;base64,aaa',
    })

    useFileStore.getState().refreshFile(PROJECT_A, {
      path: 'assets/logo.png',
      content: 'unexpected',
      language: 'plaintext',
    })

    const file = useFileStore.getState().openFilesByProject[PROJECT_A]?.[0]
    expect(file?.viewKind).toBe('image')
    expect(file?.imageDataUrl).toBe('data:image/png;base64,aaa')
    expect(file?.content).toBe('')
  })
})

// Explicit regression lock for the bug:
// Project A opened file must not appear as active/open in project B editor.
describe('fileStore - cross-project editor isolation regression', () => {
  beforeEach(() => {
    useFileStore.getState().reset()
  })

  it('keeps open tabs and active file isolated by project', () => {
    openText(PROJECT_A, 'src/F1.ts', 'A')
    openText(PROJECT_B, 'src/F2.ts', 'B')

    expect(useFileStore.getState().activeFilePathByProject[PROJECT_A]).toBe('src/F1.ts')
    expect(useFileStore.getState().activeFilePathByProject[PROJECT_B]).toBe('src/F2.ts')
    expect((useFileStore.getState().openFilesByProject[PROJECT_A] ?? []).map((f) => f.path)).toEqual(['src/F1.ts'])
    expect((useFileStore.getState().openFilesByProject[PROJECT_B] ?? []).map((f) => f.path)).toEqual(['src/F2.ts'])

    useFileStore.getState().setActiveFile(PROJECT_A, 'src/F1.ts')
    expect(useFileStore.getState().activeFilePathByProject[PROJECT_B]).toBe('src/F2.ts')
  })
})
