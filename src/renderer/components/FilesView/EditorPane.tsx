// SPDX-License-Identifier: Apache-2.0

import { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, FolderOpen, Globe, ImageIcon } from 'lucide-react'
import Editor, { loader, type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import * as monaco from 'monaco-editor'
import { useFileStore } from '@/stores/fileStore'
import { useMonacoTheme } from '@/hooks/useMonacoTheme'
import { useGutterDiff } from '@/hooks/useGutterDiff'
import { createLogger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import { MarkdownPreviewWithToc } from '../ui/MarkdownPreviewWithToc'
import { wrapHtmlForSafePreview } from '@/lib/htmlSandbox'
import { ImageLightbox } from '../DetailPanel/ImageLightbox'
import { getAppAPI } from '@/windowAPI'

const log = createLogger('Editor')

// Use locally bundled Monaco instead of CDN (required for Electron)
loader.config({ monaco })

interface EditorPaneProps {
  projectPath: string
}

type EditorViewMode = 'preview' | 'source'

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
  const [viewModeByPath, setViewModeByPath] = useState<Record<string, EditorViewMode>>({})
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null)

  const activeFile = openFiles.find((f) => f.path === activeFilePath)
  const activeViewMode = activeFilePath ? (viewModeByPath[activeFilePath] ?? 'preview') : 'preview'
  const activeExt = useMemo(() => {
    if (!activeFile) return ''
    const idx = activeFile.name.lastIndexOf('.')
    if (idx <= 0) return ''
    return activeFile.name.slice(idx + 1).toLowerCase()
  }, [activeFile])
  const isMarkdown = !!activeFile && activeFile.viewKind === 'text' && (activeFile.language === 'markdown' || activeExt === 'md')
  const isHtml = !!activeFile && activeFile.viewKind === 'text' && (activeFile.language === 'html' || activeExt === 'html' || activeExt === 'htm')
  const hasPreviewToggle = !!activeFile && (activeFile.viewKind === 'image' || isMarkdown || isHtml)

  // Git gutter diff decorations (green/amber bars, red triangles)
  useGutterDiff(mountedEditor, projectPath, activeFile?.path)

  useEffect(() => {
    if (!activeFilePath) return
    if (viewModeByPath[activeFilePath]) return
    setViewModeByPath((prev) => ({ ...prev, [activeFilePath]: 'preview' }))
  }, [activeFilePath, viewModeByPath])

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
        if (!file || file.viewKind !== 'text' || !file.isDirty) return

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
    if (value !== undefined && activeFilePath && activeFile?.viewKind === 'text') {
      updateFileContent(activeFilePath, value)
    }
  }, [activeFilePath, activeFile?.viewKind, updateFileContent])

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

  const setViewMode = (mode: EditorViewMode): void => {
    if (!activeFilePath) return
    setViewModeByPath((prev) => ({ ...prev, [activeFilePath]: mode }))
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {hasPreviewToggle && (
        <div className="h-9 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.2)] px-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
            {activeFile.viewKind === 'image' ? (
              <ImageIcon className="h-3.5 w-3.5" />
            ) : isHtml ? (
              <Globe className="h-3.5 w-3.5" />
            ) : (
              <FileText className="h-3.5 w-3.5" />
            )}
            <span className="truncate max-w-[280px]">{activeFile.name}</span>
          </div>
          <div
            className="flex rounded-md border border-[hsl(var(--border))] overflow-hidden"
            role="tablist"
            aria-label={t('editor.previewModeAria')}
          >
            <button
              role="tab"
              aria-selected={activeViewMode === 'preview'}
              onClick={() => setViewMode('preview')}
              className={cn(
                'px-2.5 py-1 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
                activeViewMode === 'preview'
                  ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                  : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
              )}
            >
              {t('common:preview')}
            </button>
            {activeFile.viewKind !== 'image' && (
              <button
                role="tab"
                aria-selected={activeViewMode === 'source'}
                onClick={() => setViewMode('source')}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
                  activeViewMode === 'source'
                    ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                    : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
                )}
              >
                {t('common:source')}
              </button>
            )}
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0">
        {activeFile.viewKind === 'image' && activeViewMode === 'preview' ? (
          <div className="h-full overflow-auto p-4 bg-[hsl(var(--muted)/0.15)]">
            {activeFile.imageDataUrl ? (
              <button
                type="button"
                className="mx-auto block rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2 hover:border-[hsl(var(--primary)/0.5)] transition-colors"
                onClick={() => setLightboxImage({ src: activeFile.imageDataUrl!, alt: activeFile.name })}
              >
                <img
                  src={activeFile.imageDataUrl}
                  alt={activeFile.name}
                  className="max-h-[70vh] max-w-full object-contain"
                />
              </button>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">
                {t('editor.unableToPreviewImage')}
              </div>
            )}
          </div>
        ) : isMarkdown && activeViewMode === 'preview' ? (
          <MarkdownPreviewWithToc content={activeFile.content} className="h-full" />
        ) : isHtml && activeViewMode === 'preview' ? (
          <iframe
            srcDoc={wrapHtmlForSafePreview(activeFile.content)}
            sandbox="allow-scripts"
            title={`HTML preview: ${activeFile.name}`}
            className="w-full h-full border-0 bg-white"
          />
        ) : activeFile.viewKind === 'text' ? (
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
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">
            {t('editor.unableToPreviewImage')}
          </div>
        )}
      </div>
      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </div>
  )
}
