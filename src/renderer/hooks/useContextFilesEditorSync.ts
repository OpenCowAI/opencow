// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/core'
import { useContextFiles } from '@/contexts/ContextFilesContext'

/**
 * Syncs pending context files into TipTap editor as fileMention nodes.
 *
 * Shared by SessionInputBar and ChatHeroInput to guarantee identical behavior
 * for drag-drop and `@` fallback context insertion paths.
 */
export function useContextFilesEditorSync(editor: Editor | null): void {
  const { files: contextFiles, acknowledgeFiles } = useContextFiles()
  const consumedPathRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!editor || contextFiles.length === 0) {
      return
    }

    const pending = contextFiles.filter((f) => !consumedPathRef.current.has(f.path))
    if (pending.length === 0) return

    const content = pending.flatMap((f) => [
      {
        type: 'fileMention' as const,
        attrs: { path: f.path, name: f.name, isDirectory: f.isDirectory },
      },
      { type: 'text' as const, text: ' ' },
    ])

    const inserted = editor.chain().focus('end').insertContent(content).run()
    if (!inserted) return

    for (const file of pending) {
      consumedPathRef.current.add(file.path)
    }
    acknowledgeFiles(pending.map((f) => f.path))
  }, [contextFiles, editor, acknowledgeFiles])

  useEffect(() => {
    if (contextFiles.length === 0 && consumedPathRef.current.size > 0) {
      consumedPathRef.current = new Set()
    }
  }, [contextFiles])
}
