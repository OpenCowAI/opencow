// SPDX-License-Identifier: Apache-2.0

/**
 * ContentViewerDialog — Full-screen dialog with syntax-highlighted CodeViewer.
 *
 * Extracted from ToolUseBlockView.tsx to reduce God Component size and enable
 * reuse across tool contexts (Write, Read, gen_html).
 *
 * Supports two content categories:
 * - **Renderable content** (.md, .html): Preview/Source toggle + Star + Download
 * - **Code content** (.js, .ts, etc.): CodeViewer only
 *
 * The `hasRichPreview` abstraction unifies markdown and HTML preview behaviour:
 * both are "source ≠ final form" content types that benefit from rendered preview.
 */

import { useState } from 'react'
import { Download, FileText, Globe, Loader2, X } from 'lucide-react'
import { Dialog } from '../../ui/Dialog'
import { MarkdownPreviewWithToc } from '../../ui/MarkdownPreviewWithToc'
import { CodeViewer } from '../../ui/code-viewer'
import { NotePopoverTrigger } from './NotesView/NotePopoverTrigger'
import { FileViewerStarButton } from '../../ui/FileViewerStarButton'
import { getAppAPI } from '@/windowAPI'
import { wrapHtmlForSafePreview } from '@/lib/htmlSandbox'

// ─── Types ───────────────────────────────────────────────────────────────────

export type ViewMode = 'preview' | 'source'

interface ContentViewerDialogProps {
  open: boolean
  onClose: () => void
  content: string
  fileName: string
  filePath: string
  language: string
  /** When true, shows a loading indicator instead of the content area */
  isLoading?: boolean
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ContentViewerDialog({
  open,
  onClose,
  content,
  fileName,
  filePath,
  language,
  isLoading,
}: ContentViewerDialogProps): React.JSX.Element {
  const isMarkdown = language === 'markdown'
  const isHtml = language === 'html'
  const hasRichPreview = isMarkdown || isHtml
  const [viewMode, setViewMode] = useState<ViewMode>(hasRichPreview ? 'preview' : 'source')
  const lineCount = content.split('\n').length

  // For in-memory content (e.g. gen_html) that has no real file path,
  // provide explicit metadata so FileViewerStarButton can derive correct mimeType/title.
  const starMetadata = !filePath && hasRichPreview
    ? { title: fileName, mimeType: isHtml ? 'text/html' : 'text/markdown', fileExtension: isHtml ? '.html' : '.md' }
    : undefined

  return (
    <Dialog open={open} onClose={onClose} title={fileName} size="3xl" className="!max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[hsl(var(--border))]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {isHtml
              ? <Globe className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
              : <FileText className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
            }
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] truncate">{fileName}</h3>
            {/* Star button — self-sufficient, resolves its own context */}
            {hasRichPreview && (
              <FileViewerStarButton filePath={filePath} content={content} metadata={starMetadata} />
            )}
            {hasRichPreview && (
              <button
                onClick={() => getAppAPI()['download-file'](fileName, content)}
                className="p-0.5 rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
                aria-label={`Download ${fileName}`}
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
          <p className="text-xs text-[hsl(var(--muted-foreground))] truncate mt-0.5">
            {filePath || fileName}
            <span className="mx-1.5">·</span>
            {language}
            <span className="mx-1.5">·</span>
            {lineCount.toLocaleString()} lines
            <span className="mx-1.5">·</span>
            {content.length.toLocaleString()} chars
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-3">
          {/* Preview / Source toggle — only for renderable content */}
          {hasRichPreview && (
            <div className="flex rounded-md border border-[hsl(var(--border))] overflow-hidden" role="tablist" aria-label="View mode">
              <button
                role="tab"
                aria-selected={viewMode === 'preview'}
                onClick={() => setViewMode('preview')}
                className={`px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] ${
                  viewMode === 'preview'
                    ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                    : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]'
                }`}
              >
                Preview
              </button>
              <button
                role="tab"
                aria-selected={viewMode === 'source'}
                onClick={() => setViewMode('source')}
                className={`px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] ${
                  viewMode === 'source'
                    ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                    : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]'
                }`}
              >
                Source
              </button>
            </div>
          )}
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
        {isLoading ? (
          <div className="h-[82vh] flex items-center justify-center">
            <Loader2 className="w-5 h-5 motion-safe:animate-spin text-[hsl(var(--muted-foreground))]" />
            <span className="ml-2 text-xs text-[hsl(var(--muted-foreground))]">Loading file…</span>
          </div>
        ) : viewMode === 'preview' && isMarkdown ? (
          <MarkdownPreviewWithToc content={content} className="h-[82vh]" />
        ) : viewMode === 'preview' && isHtml ? (
          <iframe
            srcDoc={wrapHtmlForSafePreview(content)}
            sandbox="allow-scripts"
            title={`HTML preview: ${fileName}`}
            className="w-full h-[82vh] border-0 bg-white"
          />
        ) : (
          <div className="h-[82vh]">
            <CodeViewer content={content} language={language} />
          </div>
        )}
        {/* Floating Note trigger — for renderable content */}
        {/\.(md|html?)$/i.test(filePath) && <NotePopoverTrigger sourceFilePath={filePath} />}
      </div>
    </Dialog>
  )
}
