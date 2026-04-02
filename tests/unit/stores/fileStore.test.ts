// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from 'vitest'
import { useFileStore } from '../../../src/renderer/stores/fileStore'

describe('fileStore', () => {
  beforeEach(() => {
    useFileStore.getState().reset()
  })

  it('initial state has empty files', () => {
    const state = useFileStore.getState()
    expect(state.openFiles).toEqual([])
    expect(state.activeFilePath).toBeNull()
    expect(state.expandedDirs.size).toBe(0)
    expect(state.pendingFileWritesByToolId).toEqual({})
    expect(state.pendingFileRefreshPaths).toEqual([])
  })

  it('opens a file and sets it as active', () => {
    const store = useFileStore.getState()
    store.openFile({
      path: 'src/App.tsx',
      name: 'App.tsx',
      language: 'typescriptreact',
      content: 'export function App() {}'
    })

    const state = useFileStore.getState()
    expect(state.openFiles).toHaveLength(1)
    expect(state.openFiles[0].path).toBe('src/App.tsx')
    expect(state.openFiles[0].isDirty).toBe(false)
    expect(state.activeFilePath).toBe('src/App.tsx')
  })

  it('does not duplicate already-open files', () => {
    const store = useFileStore.getState()
    store.openFile({
      path: 'src/App.tsx',
      name: 'App.tsx',
      language: 'typescriptreact',
      content: 'content'
    })
    store.openFile({
      path: 'src/App.tsx',
      name: 'App.tsx',
      language: 'typescriptreact',
      content: 'content'
    })

    expect(useFileStore.getState().openFiles).toHaveLength(1)
    expect(useFileStore.getState().activeFilePath).toBe('src/App.tsx')
  })

  it('closes a file and activates neighbor', () => {
    const store = useFileStore.getState()
    store.openFile({ path: 'a.ts', name: 'a.ts', language: 'typescript', content: '' })
    store.openFile({ path: 'b.ts', name: 'b.ts', language: 'typescript', content: '' })

    store.closeFile('b.ts')
    const state = useFileStore.getState()
    expect(state.openFiles).toHaveLength(1)
    expect(state.activeFilePath).toBe('a.ts')
  })

  it('sets activeFilePath', () => {
    const store = useFileStore.getState()
    store.openFile({ path: 'a.ts', name: 'a.ts', language: 'typescript', content: '' })
    store.openFile({ path: 'b.ts', name: 'b.ts', language: 'typescript', content: '' })

    store.setActiveFile('a.ts')
    expect(useFileStore.getState().activeFilePath).toBe('a.ts')
  })

  it('marks file dirty on content change', () => {
    const store = useFileStore.getState()
    store.openFile({ path: 'a.ts', name: 'a.ts', language: 'typescript', content: 'original' })

    store.updateFileContent('a.ts', 'modified')
    const file = useFileStore.getState().openFiles[0]
    expect(file.content).toBe('modified')
    expect(file.isDirty).toBe(true)
  })

  it('does not mark image file dirty on content update', () => {
    const store = useFileStore.getState()
    store.openFile({
      path: 'assets/logo.png',
      name: 'logo.png',
      language: 'image/png',
      content: '',
      viewKind: 'image',
      imageDataUrl: 'data:image/png;base64,abc',
    })

    store.updateFileContent('assets/logo.png', 'should-not-apply')
    const file = useFileStore.getState().openFiles[0]
    expect(file.content).toBe('')
    expect(file.isDirty).toBe(false)
  })

  it('marks file clean on save', () => {
    const store = useFileStore.getState()
    store.openFile({ path: 'a.ts', name: 'a.ts', language: 'typescript', content: 'original' })
    store.updateFileContent('a.ts', 'modified')
    store.markFileSaved('a.ts')

    const file = useFileStore.getState().openFiles[0]
    expect(file.isDirty).toBe(false)
    expect(file.savedContent).toBe('modified')
  })

  it('toggles directory expanded state', () => {
    const store = useFileStore.getState()
    store.toggleDir('src')
    expect(useFileStore.getState().expandedDirs.has('src')).toBe(true)

    store.toggleDir('src')
    expect(useFileStore.getState().expandedDirs.has('src')).toBe(false)
  })

  it('stores browser sub-path per project and supports clearing', () => {
    const store = useFileStore.getState()
    store.setBrowserSubPath('project-1', 'src/components')
    store.setBrowserSubPath('project-2', 'docs')

    expect(useFileStore.getState().browserSubPathByProject).toEqual({
      'project-1': 'src/components',
      'project-2': 'docs',
    })

    store.clearBrowserSubPath('project-1')
    expect(useFileStore.getState().browserSubPathByProject).toEqual({
      'project-2': 'docs',
    })
  })
})

describe('fileStore - refreshFile', () => {
  beforeEach(() => {
    useFileStore.getState().reset()
  })

  it('refreshFile updates content for non-dirty open file', () => {
    useFileStore.getState().openFile({ path: 'a.ts', name: 'a.ts', language: 'typescript', content: 'old' })

    useFileStore.getState().refreshFile({ path: 'a.ts', content: 'new', language: 'typescript' })
    const file = useFileStore.getState().openFiles[0]
    expect(file.content).toBe('new')
    expect(file.savedContent).toBe('new')
    expect(file.isDirty).toBe(false)
  })

  it('refreshFile skips dirty files', () => {
    useFileStore.getState().openFile({ path: 'a.ts', name: 'a.ts', language: 'typescript', content: 'original' })
    useFileStore.getState().updateFileContent('a.ts', 'user-edit')

    useFileStore.getState().refreshFile({ path: 'a.ts', content: 'from-disk', language: 'typescript' })
    const file = useFileStore.getState().openFiles[0]
    expect(file.content).toBe('user-edit')
    expect(file.isDirty).toBe(true)
  })

  it('refreshFile no-ops when content is the same', () => {
    useFileStore.getState().openFile({ path: 'a.ts', name: 'a.ts', language: 'typescript', content: 'same' })

    // Get reference before refresh
    const filesBefore = useFileStore.getState().openFiles
    useFileStore.getState().refreshFile({ path: 'a.ts', content: 'same', language: 'typescript' })
    const filesAfter = useFileStore.getState().openFiles
    // Same content → no state change → same reference
    expect(filesBefore).toBe(filesAfter)
  })

  it('refreshFile skips image files', () => {
    useFileStore.getState().openFile({
      path: 'assets/logo.png',
      name: 'logo.png',
      language: 'image/png',
      content: '',
      viewKind: 'image',
      imageDataUrl: 'data:image/png;base64,aaa',
    })

    useFileStore.getState().refreshFile({
      path: 'assets/logo.png',
      content: 'unexpected',
      language: 'plaintext',
    })

    const file = useFileStore.getState().openFiles[0]
    expect(file.viewKind).toBe('image')
    expect(file.imageDataUrl).toBe('data:image/png;base64,aaa')
    expect(file.content).toBe('')
  })
})

describe('fileStore - pending file write tracking', () => {
  beforeEach(() => {
    useFileStore.getState().reset()
  })

  it('trackPendingFileWrite stores toolUseId → filePath mapping', () => {
    useFileStore.getState().trackPendingFileWrite('tool-1', '/src/file.ts')
    expect(useFileStore.getState().pendingFileWritesByToolId['tool-1']).toBe('/src/file.ts')
  })

  it('resolvePendingFileWrite returns and removes the mapping atomically', () => {
    useFileStore.getState().trackPendingFileWrite('tool-1', '/src/file.ts')

    const result = useFileStore.getState().resolvePendingFileWrite('tool-1')
    expect(result).toBe('/src/file.ts')
    expect(useFileStore.getState().pendingFileWritesByToolId['tool-1']).toBeUndefined()
  })

  it('resolvePendingFileWrite returns null for unknown toolUseId', () => {
    const result = useFileStore.getState().resolvePendingFileWrite('unknown')
    expect(result).toBeNull()
  })
})

describe('fileStore - pending file refresh paths', () => {
  beforeEach(() => {
    useFileStore.getState().reset()
  })

  it('markFileNeedsRefresh adds unique paths', () => {
    useFileStore.getState().markFileNeedsRefresh('/src/a.ts')
    useFileStore.getState().markFileNeedsRefresh('/src/b.ts')
    useFileStore.getState().markFileNeedsRefresh('/src/a.ts') // duplicate

    expect(useFileStore.getState().pendingFileRefreshPaths).toEqual(['/src/a.ts', '/src/b.ts'])
  })

  it('markAllOpenFilesNeedRefresh adds all non-dirty open file paths', () => {
    useFileStore.getState().openFile({ path: 'a.ts', name: 'a.ts', language: 'typescript', content: 'a' })
    useFileStore.getState().openFile({ path: 'b.ts', name: 'b.ts', language: 'typescript', content: 'b' })
    useFileStore.getState().updateFileContent('b.ts', 'dirty-b') // make b dirty

    useFileStore.getState().markAllOpenFilesNeedRefresh()
    // Only non-dirty file (a.ts) should be added
    expect(useFileStore.getState().pendingFileRefreshPaths).toContain('a.ts')
    expect(useFileStore.getState().pendingFileRefreshPaths).not.toContain('b.ts')
  })

  it('consumePendingFileRefresh atomically returns and clears paths', () => {
    useFileStore.getState().markFileNeedsRefresh('/src/a.ts')
    useFileStore.getState().markFileNeedsRefresh('/src/b.ts')

    const consumed = useFileStore.getState().consumePendingFileRefresh()
    expect(consumed).toEqual(['/src/a.ts', '/src/b.ts'])
    expect(useFileStore.getState().pendingFileRefreshPaths).toEqual([])
  })

  it('consumePendingFileRefresh returns empty array when nothing pending', () => {
    const consumed = useFileStore.getState().consumePendingFileRefresh()
    expect(consumed).toEqual([])
  })

  it('clearPendingFileRefresh empties the queue', () => {
    useFileStore.getState().markFileNeedsRefresh('/src/a.ts')
    useFileStore.getState().clearPendingFileRefresh()
    expect(useFileStore.getState().pendingFileRefreshPaths).toEqual([])
  })
})

describe('fileStore - reset', () => {
  it('reset() restores initial state', () => {
    useFileStore.getState().openFile({ path: 'a.ts', name: 'a.ts', language: 'typescript', content: '' })
    useFileStore.getState().toggleDir('src')
    useFileStore.getState().trackPendingFileWrite('tool-1', '/src/a.ts')
    useFileStore.getState().markFileNeedsRefresh('/src/a.ts')

    useFileStore.getState().reset()

    const state = useFileStore.getState()
    expect(state.openFiles).toEqual([])
    expect(state.activeFilePath).toBeNull()
    expect(state.expandedDirs.size).toBe(0)
    expect(state.browserSubPathByProject).toEqual({})
    expect(state.pendingFileWritesByToolId).toEqual({})
    expect(state.pendingFileRefreshPaths).toEqual([])
  })
})
