// SPDX-License-Identifier: Apache-2.0

/**
 * DiffViewerDialog — Full-screen dialog for Edit tool with Diff / Preview / Full / Source tabs.
 *
 * Extracted from ToolUseBlockView.tsx to enable reuse at the SessionPanel level
 * (rendered outside the virtualised message list via ContentViewerContext).
 *
 * Tabs:
 * - Diff: Monaco DiffEditor side-by-side (default)
 * - Preview: rendered Markdown or HTML of newString (for .md / .html files)
 * - Full: full file content loaded from disk on demand
 * - Source: Monaco Editor showing newString
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { Download, FileText, Globe, X } from 'lucide-react'
import { Dialog } from '../../ui/Dialog'
import { MarkdownPreviewWithToc } from '../../ui/MarkdownPreviewWithToc'
import { CodeViewer } from '../../ui/code-viewer'
import { DiffEditor as MonacoDiffEditor } from '@monaco-editor/react'
import { NotePopoverTrigger } from './NotesView/NotePopoverTrigger'
import { FileViewerStarButton } from '../../ui/FileViewerStarButton'
import { useMonacoTheme } from '@/hooks/useMonacoTheme'
import { detectLanguage } from '@shared/fileUtils'
import { getAppAPI } from '@/windowAPI'
import { wrapHtmlForSafePreview } from '@/lib/htmlSandbox'

// ─── Types ───────────────────────────────────────────────────────────────────

type EditViewMode = 'diff' | 'preview' | 'full' | 'source'

interface DiffViewerDialogProps {
  open: boolean
  onClose: () => void
  oldString: string
  newString: string
  filePath: string
  sessionId?: string
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DiffViewerDialog({
  open,
  onClose,
  oldString,
  newString,
  filePath,
  sessionId,
}: DiffViewerDialogProps): React.JSX.Element {
  const monacoTheme = useMonacoTheme()
  const fileName = filePath.split('/').pop() ?? filePath
  const language = detectLanguage(filePath)
  const isMarkdown = language === 'markdown'
  const isHtml = language === 'html'
  const hasRichPreview = isMarkdown || isHtml
  const [viewMode, setViewMode] = useState<EditViewMode>('diff')

  // Full tab: load complete file content on demand
  const [fullContent, setFullContent] = useState<string | null>(null)
  const [fullLoading, setFullLoading] = useState(false)
  const [fullError, setFullError] = useState<string | null>(null)
  const fullLoadRequestId = useRef(0)

  useEffect(() => {
    fullLoadRequestId.current += 1
    setViewMode('diff')
    setFullContent(null)
    setFullError(null)
    setFullLoading(false)
  }, [open, filePath, sessionId])

  const loadFullContent = useCallback(async () => {
    if (fullContent !== null || fullLoading) return
    if (!sessionId) {
      setFullError('Session context unavailable')
      return
    }
    const requestId = ++fullLoadRequestId.current
    setFullLoading(true)
    setFullError(null)
    try {
      const result = await getAppAPI()['view-tool-file-content']({ sessionId, filePath })
      if (requestId !== fullLoadRequestId.current) return
      if (!result.ok) {
        setFullError(result.error.message || 'Failed to load file')
        return
      }
      setFullContent(result.data.content)
    } catch (err) {
      if (requestId !== fullLoadRequestId.current) return
      setFullError(err instanceof Error ? err.message : 'Failed to load file')
    } finally {
      // eslint-disable-next-line no-unsafe-finally
      if (requestId !== fullLoadRequestId.current) return
      setFullLoading(false)
    }
  }, [filePath, fullContent, fullLoading, sessionId])

  // Auto-load when switching to Full tab
  useEffect(() => {
    if (viewMode === 'full') {
      loadFullContent()
    }
  }, [viewMode, loadFullContent])

  const oldLineCount = oldString.split('\n').length
  const newLineCount = newString.split('\n').length
  const fullLineCount = fullContent?.split('\n').length

  const tabs: { key: EditViewMode; label: string }[] = [
    { key: 'diff', label: 'Diff' },
    ...(hasRichPreview ? [{ key: 'preview' as const, label: 'Preview' }] : []),
    ...(sessionId ? [{ key: 'full' as const, label: 'Full' }] : []),
    { key: 'source', label: 'Source' },
  ]

  const tabButtonClass = (active: boolean): string =>
    `px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] ${
      active
        ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
        : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]'
    }`

  return (
    <Dialog open={open} onClose={onClose} title={`${fileName}`} size="3xl" className="!max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[hsl(var(--border))]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {isHtml
              ? <Globe className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
              : <FileText className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
            }
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] truncate">{fileName}</h3>
            {hasRichPreview && (
              <FileViewerStarButton filePath={filePath} content={newString} />
            )}
            {hasRichPreview && (
              <button
                onClick={() => getAppAPI()['download-file'](fileName, newString)}
                className="p-0.5 rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
                aria-label={`Download ${fileName}`}
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
          <p className="text-xs text-[hsl(var(--muted-foreground))] truncate mt-0.5">
            {filePath}
            <span className="mx-1.5">·</span>
            {language}
            <span className="mx-1.5">·</span>
            {viewMode === 'diff' ? (
              <>
                <span className="text-red-400">{oldLineCount} lines</span>
                <span className="mx-1">→</span>
                <span className="text-green-400">{newLineCount} lines</span>
              </>
            ) : viewMode === 'full' && fullContent ? (
              <>
                {fullLineCount?.toLocaleString()} lines
                <span className="mx-1.5">·</span>
                {fullContent.length.toLocaleString()} chars
                <span className="mx-1.5">·</span>
                full file
              </>
            ) : (
              <>
                {newLineCount.toLocaleString()} lines
                <span className="mx-1.5">·</span>
                {newString.length.toLocaleString()} chars
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-3">
          {/* Diff / Preview / Source tabs */}
          <div className="flex rounded-md border border-[hsl(var(--border))] overflow-hidden" role="tablist" aria-label="Edit view mode">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                role="tab"
                aria-selected={viewMode === tab.key}
                onClick={() => setViewMode(tab.key)}
                className={tabButtonClass(viewMode === tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            aria-label="Close viewer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="relative">
        {viewMode === 'diff' ? (
          <div className="h-[82vh]">
            <MonacoDiffEditor
              original={oldString}
              modified={newString}
              language={language}
              theme={monacoTheme}
              options={{
                fontSize: 13,
                lineHeight: 20,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                readOnly: true,
                domReadOnly: true,
                renderSideBySide: true,
                automaticLayout: true,
                contextmenu: false,
                scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
                padding: { top: 8 }
              }}
            />
          </div>
        ) : viewMode === 'full' ? (
          fullLoading ? (
            <div className="h-[82vh] flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-[hsl(var(--muted-foreground))]">
                <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">Loading full file…</span>
              </div>
            </div>
          ) : fullError ? (
            <div className="h-[82vh] flex items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-[hsl(var(--muted-foreground))]">
                <span className="text-sm text-[hsl(var(--destructive))]">{fullError}</span>
                <button
                  onClick={() => { setFullContent(null); setFullError(null); loadFullContent() }}
                  className="text-xs px-3 py-1.5 rounded-md border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : fullContent && isMarkdown ? (
            <MarkdownPreviewWithToc content={fullContent} className="h-[82vh]" />
          ) : fullContent && isHtml ? (
            <iframe
              srcDoc={wrapHtmlForSafePreview(fullContent)}
              sandbox="allow-scripts"
              title={`Full HTML preview: ${fileName}`}
              className="w-full h-[82vh] border-0 bg-white"
            />
          ) : fullContent ? (
            <div className="h-[82vh]">
              <CodeViewer content={fullContent} language={language} />
            </div>
          ) : null
        ) : viewMode === 'preview' && isMarkdown ? (
          <MarkdownPreviewWithToc content={newString} className="h-[82vh]" />
        ) : viewMode === 'preview' && isHtml ? (
          <iframe
            srcDoc={wrapHtmlForSafePreview(newString)}
            sandbox="allow-scripts"
            title={`HTML preview: ${fileName}`}
            className="w-full h-[82vh] border-0 bg-white"
          />
        ) : (
          <div className="h-[82vh]">
            <CodeViewer content={newString} language={language} />
          </div>
        )}
        {/* Floating Note trigger — for renderable content (.md, .html) */}
        {/\.(md|html?)$/i.test(filePath) && <NotePopoverTrigger sourceFilePath={filePath} />}
      </div>
    </Dialog>
  )
}
