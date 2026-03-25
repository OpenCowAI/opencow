// SPDX-License-Identifier: Apache-2.0

import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen } from 'lucide-react'
import Editor, { loader, type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import * as monaco from 'monaco-editor'
import { useFileStore } from '@/stores/fileStore'
import { useMonacoTheme } from '@/hooks/useMonacoTheme'
import { useGutterDiff } from '@/hooks/useGutterDiff'
import { createLogger } from '@/lib/logger'
import { getAppAPI } from '@/windowAPI'

const log = createLogger('Editor')

// Use locally bundled Monaco instead of CDN (required for Electron)
loader.config({ monaco })

interface EditorPaneProps {
  projectPath: string
}

export function EditorPane({ projectPath }: EditorPaneProps): React.JSX.Element {
  const { t } = useTranslation('files')
  const openFiles = useFileStore((s) => s.openFiles)
  const activeFilePath = useFileStore((s) => s.activeFilePath)
  const updateFileContent = useFileStore((s) => s.updateFileContent)
  const markFileSaved = useFileStore((s) => s.markFileSaved)
  const monacoTheme = useMonacoTheme()

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  // State-based tracking so useGutterDiff's useEffect can react to editor mount.
  // Ref alone doesn't trigger re-renders — useState gives the hook a proper dependency.
  const [mountedEditor, setMountedEditor] = useState<editor.IStandaloneCodeEditor | null>(null)

  const activeFile = openFiles.find((f) => f.path === activeFilePath)

  // Git gutter diff decorations (green/amber bars, red triangles)
  useGutterDiff(mountedEditor, projectPath, activeFile?.path)

  const handleEditorMount: OnMount = useCallback((editorInstance, monacoInstance) => {
    editorRef.current = editorInstance
    setMountedEditor(editorInstance)

    // Cmd+S / Ctrl+S to save
    editorInstance.addAction({
      id: 'opencow-save-file',
      label: t('editor.saveFile'),
      keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS],
      run: async () => {
        const path = useFileStore.getState().activeFilePath
        if (!path) return
        const file = useFileStore.getState().openFiles.find((f) => f.path === path)
        if (!file || !file.isDirty) return

        try {
          const result = await getAppAPI()['save-file-content'](projectPath, path, file.content)
          if (!result.ok) {
            log.error('Failed to save file', result.error)
            return
          }
          markFileSaved(path)
        } catch (err) {
          log.error('Failed to save file', err)
        }
      },
    })
  }, [projectPath, markFileSaved, t])

  const handleChange = useCallback((value: string | undefined) => {
    if (value !== undefined && activeFilePath) {
      updateFileContent(activeFilePath, value)
    }
  }, [activeFilePath, updateFileContent])

  if (!activeFile) {
    return (
      <div className="h-full flex items-center justify-center px-6">
        <div className="w-full max-w-md text-center">
          <div className="flex items-center justify-center gap-2 text-[hsl(var(--muted-foreground))]">
            <span className="h-px w-8 bg-[hsl(var(--border))]" aria-hidden="true" />
            <FolderOpen className="h-4 w-4" aria-hidden="true" />
            <span className="text-[11px] font-medium tracking-[0.03em] uppercase">
              {t('editor.emptyStateTitle')}
            </span>
            <span className="h-px w-8 bg-[hsl(var(--border))]" aria-hidden="true" />
          </div>
          <p className="mt-3 text-sm text-[hsl(var(--foreground))]">
            {t('editor.openFilePrompt')}
          </p>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
            {t('editor.emptyStateHint')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <Editor
      key={activeFile.path}
      value={activeFile.content}
      language={activeFile.language}
      theme={monacoTheme}
      onChange={handleChange}
      onMount={handleEditorMount}
      options={{
        fontSize: 13,
        lineHeight: 20,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        tabSize: 2,
        renderWhitespace: 'selection',
        bracketPairColorization: { enabled: true },
        automaticLayout: true,
        padding: { top: 8 },
      }}
    />
  )
}
