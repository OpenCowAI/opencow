// SPDX-License-Identifier: Apache-2.0

import type { FilesDisplayMode, ImagePreviewReadResult } from '@shared/types'
import { normalizeFileContentReadResult } from '@/lib/fileContentReadResult'
import { createLogger } from '@/lib/logger'

const log = createLogger('FileSearchNavigation')

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico'])

function extensionOf(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx <= 0) return ''
  return name.slice(idx + 1).toLowerCase()
}

function parentDirPath(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(0, slash) : ''
}

function isPositiveLine(line: number | null): line is number {
  return typeof line === 'number' && Number.isFinite(line) && line > 0
}

export interface FileSearchNavigationProject {
  id: string
  path: string
}

export interface FileSearchOpenFileRequest {
  path: string
  name: string
  language: string
  content: string
  viewKind?: 'text' | 'image'
  imageDataUrl?: string | null
}

export interface FileSearchNavigationReaders {
  readFileContent: (projectPath: string, filePath: string) => Promise<unknown>
  readImagePreview: (projectPath: string, filePath: string) => Promise<ImagePreviewReadResult>
}

export interface FileSearchNavigationWriters {
  setFilesDisplayMode: (projectId: string, mode: FilesDisplayMode) => void
  setBrowserSubPath: (projectId: string, subPath: string) => void
  setBrowserExternalOpenPath: (path: string | null) => void
  openFile: (request: FileSearchOpenFileRequest) => void
  enqueueEditorJumpIntent: (projectId: string, jump: { path: string; line: number }) => void
  enqueueTreeRevealIntent: (projectId: string, reveal: { path: string }) => void
}

export interface FileSearchNavigationDependencies {
  project: FileSearchNavigationProject
  readers: FileSearchNavigationReaders
  writers: FileSearchNavigationWriters
}

interface FileSearchNavigationContext {
  mode: FilesDisplayMode
}

interface FileSearchNavigationOpenOptions {
  line: number | null
}

export interface FileSearchNavigationTarget {
  path: string
  name: string
  isDirectory: boolean
}

export type FileSearchOverlayAction = 'current' | 'editor' | 'reveal'

export type FileSearchNavigationCommand =
  | {
      kind: 'open-current'
      target: FileSearchNavigationTarget
      context: FileSearchNavigationContext
      options: FileSearchNavigationOpenOptions
    }
  | {
      kind: 'open-editor'
      target: FileSearchNavigationTarget
      options: FileSearchNavigationOpenOptions
    }
  | {
      kind: 'reveal'
      target: FileSearchNavigationTarget
      context: FileSearchNavigationContext
    }

export type FileSearchActionLabelToken =
  | 'open'
  | 'openFolder'
  | 'revealInTree'
  | 'openInEditor'
  | 'revealParent'
  | 'reveal'

export interface FileSearchActionLabelTokens {
  current: FileSearchActionLabelToken
  editor: FileSearchActionLabelToken
  reveal: FileSearchActionLabelToken
}

interface BuildFileSearchCommandInput {
  action: FileSearchOverlayAction
  target: FileSearchNavigationTarget
  mode: FilesDisplayMode
  line: number | null
}

export function buildFileSearchNavigationCommand(
  input: BuildFileSearchCommandInput,
): FileSearchNavigationCommand {
  const { action, target, mode, line } = input
  if (action === 'editor') {
    return {
      kind: 'open-editor',
      target,
      options: { line },
    }
  }
  if (action === 'reveal') {
    return {
      kind: 'reveal',
      target,
      context: { mode },
    }
  }
  return {
    kind: 'open-current',
    target,
    context: { mode },
    options: { line },
  }
}

export function resolveFileSearchActionLabels(
  target: FileSearchNavigationTarget | null,
  mode: FilesDisplayMode,
): FileSearchActionLabelTokens {
  const isDirectory = target?.isDirectory === true
  if (isDirectory) {
    return {
      current: mode === 'browser' ? 'openFolder' : 'revealInTree',
      editor: 'revealInTree',
      reveal: 'revealParent',
    }
  }
  return {
    current: 'open',
    editor: 'openInEditor',
    reveal: 'reveal',
  }
}

export interface FileSearchNavigationExecutor {
  execute: (command: FileSearchNavigationCommand) => Promise<void>
}

export function createFileSearchNavigationExecutor(
  deps: FileSearchNavigationDependencies,
): FileSearchNavigationExecutor {
  const { project, readers, writers } = deps

  async function openInEditor(target: FileSearchNavigationTarget, line: number | null): Promise<void> {
    if (target.isDirectory) {
      // Directory targets cannot be opened in Monaco; reveal the node in tree.
      writers.setFilesDisplayMode(project.id, 'ide')
      writers.enqueueTreeRevealIntent(project.id, { path: target.path })
      return
    }

    const ext = extensionOf(target.name)
    if (IMAGE_EXTENSIONS.has(ext)) {
      const imageResult = await readers.readImagePreview(project.path, target.path)
      if (!imageResult.ok) return

      writers.openFile({
        path: target.path,
        name: target.name,
        language: imageResult.data.mimeType,
        content: '',
        viewKind: 'image',
        imageDataUrl: imageResult.data.dataUrl,
      })
      writers.setFilesDisplayMode(project.id, 'ide')
      return
    }

    const rawResult = await readers.readFileContent(project.path, target.path)
    const result = normalizeFileContentReadResult(rawResult)
    if (!result.ok) return

    writers.openFile({
      path: target.path,
      name: target.name,
      language: result.data.language,
      content: result.data.content,
      viewKind: 'text',
      imageDataUrl: null,
    })
    writers.setFilesDisplayMode(project.id, 'ide')

    if (isPositiveLine(line)) {
      writers.enqueueEditorJumpIntent(project.id, { path: target.path, line })
    }
  }

  async function openInCurrentMode(
    target: FileSearchNavigationTarget,
    line: number | null,
    mode: FilesDisplayMode,
  ): Promise<void> {
    if (target.isDirectory) {
      if (mode === 'browser') {
        writers.setBrowserSubPath(project.id, target.path)
        writers.setBrowserExternalOpenPath(null)
        return
      }
      writers.enqueueTreeRevealIntent(project.id, { path: target.path })
      return
    }

    if (mode === 'ide' || isPositiveLine(line)) {
      await openInEditor(target, line)
      return
    }

    writers.setBrowserSubPath(project.id, parentDirPath(target.path))
    writers.setBrowserExternalOpenPath(target.path)
  }

  function revealOnly(target: FileSearchNavigationTarget, mode: FilesDisplayMode): void {
    if (mode === 'browser') {
      writers.setBrowserSubPath(project.id, parentDirPath(target.path))
      writers.setBrowserExternalOpenPath(null)
      return
    }

    writers.enqueueTreeRevealIntent(project.id, { path: target.path })
  }

  return {
    async execute(command: FileSearchNavigationCommand): Promise<void> {
      try {
        if (command.kind === 'open-current') {
          await openInCurrentMode(command.target, command.options.line, command.context.mode)
          return
        }
        if (command.kind === 'open-editor') {
          await openInEditor(command.target, command.options.line)
          return
        }
        revealOnly(command.target, command.context.mode)
      } catch (err) {
        log.error('Failed to execute file-search navigation command', err)
      }
    },
  }
}
