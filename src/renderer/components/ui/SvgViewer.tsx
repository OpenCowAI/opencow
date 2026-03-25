// SPDX-License-Identifier: Apache-2.0

/**
 * SvgViewer — fullscreen modal for inspecting SVG diagrams.
 *
 * Features:
 * - Mouse-wheel zoom (centered on cursor)
 * - Click-drag pan
 * - Toolbar: zoom-in / zoom-out / reset / close
 * - ESC to close
 * - Click backdrop to close
 * - Follows the existing `ImageLightbox` visual pattern
 */

import { memo, useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, ZoomIn, ZoomOut, RotateCcw, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useExitAnimation } from '@/hooks/useModalAnimation'
import { useBlockBrowserView } from '@/hooks/useBlockBrowserView'
import { getAppAPI } from '@/windowAPI'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ZOOM_MIN = 0.25
const ZOOM_MAX = 5
const ZOOM_STEP = 0.25
const ZOOM_WHEEL_SENSITIVITY = 0.001

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SvgViewerProps {
  /** Raw SVG markup to display. */
  svg: string
  /** Called when the viewer should close (ESC, backdrop click, close button). */
  onClose: () => void
  /** Optional custom file name for SVG download (default: 'diagram.svg'). */
  downloadName?: string
}

interface ViewState {
  zoom: number
  panX: number
  panY: number
}

const INITIAL_VIEW: ViewState = { zoom: 1, panX: 0, panY: 0 }

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SvgViewer = memo(function SvgViewer({ svg, onClose, downloadName = 'diagram.svg' }: SvgViewerProps): React.JSX.Element {
  const { phase, requestClose } = useExitAnimation(onClose)
  useBlockBrowserView('svg-viewer', true)
  const [view, setView] = useState<ViewState>(INITIAL_VIEW)
  const isDragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const canvasRef = useRef<HTMLDivElement>(null)

  // ---- Keyboard ----

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') requestClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [requestClose])

  // ---- Zoom (clamp helper) ----

  const clampZoom = useCallback(
    (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)),
    []
  )

  // ---- Wheel zoom ----

  const onWheel = useCallback(
    (e: React.WheelEvent): void => {
      e.preventDefault()
      setView((prev) => ({
        ...prev,
        zoom: clampZoom(prev.zoom - e.deltaY * ZOOM_WHEEL_SENSITIVITY * prev.zoom),
      }))
    },
    [clampZoom]
  )

  // ---- Drag pan ----

  const onPointerDown = useCallback((e: React.PointerEvent): void => {
    if (e.button !== 0) return // left click only
    isDragging.current = true
    dragStart.current = { x: e.clientX, y: e.clientY }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent): void => {
    if (!isDragging.current) return
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    dragStart.current = { x: e.clientX, y: e.clientY }
    setView((prev) => ({
      ...prev,
      panX: prev.panX + dx,
      panY: prev.panY + dy,
    }))
  }, [])

  const onPointerUp = useCallback((): void => {
    isDragging.current = false
  }, [])

  // ---- Toolbar actions ----

  const zoomIn = useCallback(
    () => setView((prev) => ({ ...prev, zoom: clampZoom(prev.zoom + ZOOM_STEP) })),
    [clampZoom]
  )

  const zoomOut = useCallback(
    () => setView((prev) => ({ ...prev, zoom: clampZoom(prev.zoom - ZOOM_STEP) })),
    [clampZoom]
  )

  const resetView = useCallback(() => setView(INITIAL_VIEW), [])

  const handleDownload = useCallback(() => {
    getAppAPI()['download-file'](downloadName, svg)
  }, [downloadName, svg])

  // ---- Percentage label ----

  const zoomLabel = `${Math.round(view.zoom * 100)}%`

  // ---- Render ----

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overscroll-contain no-drag"
      role="dialog"
      aria-modal="true"
      aria-label="SVG diagram viewer"
    >
      <div
        className={cn(
          'absolute inset-0 bg-black/70',
          phase === 'enter' && 'modal-overlay-enter',
          phase === 'exit' && 'modal-overlay-exit'
        )}
        onClick={requestClose}
        aria-hidden="true"
      />
      {/* Toolbar — top-right */}
      <div
        className={cn(
          'absolute top-4 right-4 z-10 flex items-center gap-1',
          'rounded-lg bg-black/60 backdrop-blur-sm px-2 py-1.5',
          phase === 'enter' && 'modal-content-enter',
          phase === 'exit' && 'modal-content-exit'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-xs text-white/70 tabular-nums min-w-[3ch] text-center select-none">
          {zoomLabel}
        </span>

        <ToolbarButton icon={ZoomIn} label="Zoom in" onClick={zoomIn} />
        <ToolbarButton icon={ZoomOut} label="Zoom out" onClick={zoomOut} />
        <ToolbarButton icon={RotateCcw} label="Reset view" onClick={resetView} />

        <div className="w-px h-4 bg-white/20 mx-0.5" />

        <ToolbarButton icon={Download} label="Download SVG" onClick={handleDownload} />

        <div className="w-px h-4 bg-white/20 mx-0.5" />

        <ToolbarButton icon={X} label="Close" onClick={requestClose} />
      </div>

      {/* Canvas — zoom & pan via CSS transform */}
      <div
        ref={canvasRef}
        className="cursor-grab active:cursor-grabbing select-none"
        style={{
          transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
          transformOrigin: 'center center',
          willChange: 'transform',
        }}
        onClick={(e) => e.stopPropagation()}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div
          className="[&>svg]:max-w-[90vw] [&>svg]:max-h-[85vh] [&>svg]:w-auto [&>svg]:h-auto"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>,
    document.body
  )
})

// ---------------------------------------------------------------------------
// ToolbarButton
// ---------------------------------------------------------------------------

interface ToolbarButtonProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
}

function ToolbarButton({ icon: Icon, label, onClick }: ToolbarButtonProps): React.JSX.Element {
  return (
    <button
      className={cn(
        'p-1 rounded text-white/80 hover:text-white hover:bg-white/10',
        'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white'
      )}
      onClick={onClick}
      aria-label={label}
    >
      <Icon className="w-4 h-4" />
    </button>
  )
}
