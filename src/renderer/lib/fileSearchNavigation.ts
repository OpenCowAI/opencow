// SPDX-License-Identifier: Apache-2.0

import type { ImagePreviewReadResult } from '@shared/types'
import { normalizeFileContentReadResult } from '@/lib/fileContentReadResult'
import { createLogger } from '@/lib/logger'

const log = createLogger('FileSearchNavigation')

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico'])

function extensionOf(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx <= 0) return ''
  return name.slice(idx + 1).toLowerCase()
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
  openFile: (request: FileSearchOpenFileRequest) => void
  enqueueEditorJumpIntent: (projectId: string, jump: { path: string; line: number }) => void
  enqueueTreeRevealIntent: (projectId: string, reveal: { path: string }) => void
}

export interface FileSearchNavigationDependencies {
  project: FileSearchNavigationProject
  readers: FileSearchNavigationReaders
  writers: FileSearchNavigationWriters
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
  line: number | null
}

export function buildFileSearchNavigationCommand(
  input: BuildFileSearchCommandInput,
): FileSearchNavigationCommand {
  const { action, target, line } = input
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
    }
  }
  return {
    kind: 'open-current',
    target,
    options: { line },
  }
}

export function resolveFileSearchActionLabels(
  target: FileSearchNavigationTarget | null,
): FileSearchActionLabelTokens {
  const isDirectory = target?.isDirectory === true
  if (isDirectory) {
    return {
      current: 'revealInTree',
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

    if (isPositiveLine(line)) {
      writers.enqueueEditorJumpIntent(project.id, { path: target.path, line })
    }
  }

  function revealOnly(target: FileSearchNavigationTarget): void {
    writers.enqueueTreeRevealIntent(project.id, { path: target.path })
  }

  return {
    async execute(command: FileSearchNavigationCommand): Promise<void> {
      try {
        if (command.kind === 'open-current') {
          await openInEditor(command.target, command.options.line)
          return
        }
        if (command.kind === 'open-editor') {
          await openInEditor(command.target, command.options.line)
          return
        }
        revealOnly(command.target)
      } catch (err) {
        log.error('Failed to execute file-search navigation command', err)
      }
    },
  }
}
