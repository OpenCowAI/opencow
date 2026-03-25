// SPDX-License-Identifier: Apache-2.0

/**
 * MermaidBlock — renders a Mermaid code block as an interactive SVG diagram.
 *
 * Capabilities:
 * - Synchronous rendering via beautiful-mermaid (no layout flash)
 * - Automatic theme adaptation from OpenCow CSS variables
 * - Graceful error degradation (shows code block + error hint)
 * - Toggle between diagram view and source view
 * - Click diagram to open fullscreen {@link SvgViewer} modal
 */

import { memo, useState, useMemo, useCallback } from 'react'
import { Code, Image, Maximize2, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { renderMermaid, resolveThemeColors } from '@/lib/mermaidRenderer'
import { SvgViewer } from './SvgViewer'
import { getAppAPI } from '@/windowAPI'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MermaidBlockProps {
  /** Raw Mermaid source text. */
  code: string
}

/** Discriminated union — eliminates the need for non-null assertions. */
type RenderResult =
  | { ok: true; svg: string }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

/** Fenced code block used by both error and source views. */
function SourceCode({ code }: { code: string }): React.JSX.Element {
  return (
    <pre className="bg-[hsl(var(--muted))] rounded-b p-1.5 text-sm font-mono overflow-x-auto">
      <code>{code}</code>
    </pre>
  )
}

// ---------------------------------------------------------------------------
// MermaidBlock
// ---------------------------------------------------------------------------

export const MermaidBlock = memo(function MermaidBlock({ code }: MermaidBlockProps): React.JSX.Element {
  const [showSource, setShowSource] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)

  const result = useMemo((): RenderResult => {
    try {
      const options = resolveThemeColors()
      return { ok: true, svg: renderMermaid(code, options) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Render failed' }
    }
  }, [code])

  // ---- Download handlers ----
  const handleDownloadSvg = useCallback(() => {
    if (result.ok) {
      getAppAPI()['download-file']('diagram.svg', result.svg)
    }
  }, [result])

  const handleDownloadSource = useCallback(() => {
    getAppAPI()['download-file']('diagram.mmd', code)
  }, [code])

  // ---- Error state ----
  if (!result.ok) {
    return (
      <div className="my-2">
        <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/0.1)] rounded-t">
          <span>Mermaid render error: {result.error}</span>
        </div>
        <SourceCode code={code} />
      </div>
    )
  }

  // ---- Source view ----
  if (showSource) {
    return (
      <div className="my-2 group/mermaid">
        <div className="flex justify-end gap-0.5 px-1.5 py-0.5 bg-[hsl(var(--muted))] rounded-t">
          <ToolbarButton
            icon={Download}
            label="Download source"
            onClick={handleDownloadSource}
          />
          <ToolbarButton
            icon={Image}
            label="Show diagram"
            text="Diagram"
            onClick={() => setShowSource(false)}
          />
        </div>
        <SourceCode code={code} />
      </div>
    )
  }

  // ---- Diagram view (default) ----
  return (
    <div className="my-2 group/mermaid">
      <div
        className={cn(
          'relative rounded border border-[hsl(var(--border))]',
          'bg-[hsl(var(--background))] overflow-x-auto'
        )}
      >
        {/* Toolbar — visible on hover */}
        <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover/mermaid:opacity-100 transition-opacity z-10">
          <ToolbarButton
            icon={Maximize2}
            label="Expand diagram"
            onClick={() => setViewerOpen(true)}
          />
          <ToolbarButton
            icon={Download}
            label="Download SVG"
            onClick={handleDownloadSvg}
          />
          <ToolbarButton
            icon={Code}
            label="Show source code"
            text="Source"
            onClick={() => setShowSource(true)}
          />
        </div>

        {/* SVG diagram — click to expand */}
        <div
          className="flex justify-center p-3 [&>svg]:max-w-full [&>svg]:h-auto cursor-pointer"
          onClick={() => setViewerOpen(true)}
          role="button"
          tabIndex={0}
          aria-label="Click to expand diagram"
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViewerOpen(true) } }}
          dangerouslySetInnerHTML={{ __html: result.svg }}
        />
      </div>

      {/* Fullscreen viewer modal */}
      {viewerOpen && (
        <SvgViewer svg={result.svg} onClose={() => setViewerOpen(false)} />
      )}
    </div>
  )
})

// ---------------------------------------------------------------------------
// ToolbarButton — shared small action button
// ---------------------------------------------------------------------------

interface ToolbarButtonProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  text?: string
  onClick: () => void
}

function ToolbarButton({ icon: Icon, label, text, onClick }: ToolbarButtonProps): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px]',
        'bg-[hsl(var(--muted)/0.8)] backdrop-blur-sm',
        'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]',
        'transition-colors'
      )}
      aria-label={label}
    >
      <Icon className="w-3 h-3" aria-hidden="true" />
      {text}
    </button>
  )
}
