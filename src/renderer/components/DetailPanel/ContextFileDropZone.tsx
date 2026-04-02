// SPDX-License-Identifier: Apache-2.0

import { useState, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { DropOverlay } from './DropOverlay'
import { hasContextFileDrag, readContextFileDrag } from '@/lib/contextFileDnd'
import type { ContextFileDescriptor } from '@shared/contextFileDnd'

interface ContextFileDropPayload {
  files: ContextFileDescriptor[]
  source: 'internal-file-dnd'
}

interface ContextFileDropZoneProps {
  children: React.ReactNode
  className?: string
  onFilesDrop: (payload: ContextFileDropPayload) => void
}

/**
 * Drop zone for OpenCow internal file-tree drags (`application/x-opencow-file`).
 *
 * Accepts file/directory entries and forwards them to ContextFilesContext so
 * input components can insert fileMention nodes using the same pipeline as `@`.
 */
export function ContextFileDropZone({
  children,
  className,
  onFilesDrop,
}: ContextFileDropZoneProps): React.JSX.Element {
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounterRef = useRef(0)

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasContextFileDrag(e.dataTransfer)) return
    e.preventDefault()
    dragCounterRef.current += 1
    if (dragCounterRef.current === 1) setIsDragOver(true)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!hasContextFileDrag(e.dataTransfer)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!hasContextFileDrag(e.dataTransfer)) return
    dragCounterRef.current -= 1
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setIsDragOver(false)
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!hasContextFileDrag(e.dataTransfer)) return

      e.preventDefault()
      dragCounterRef.current = 0
      setIsDragOver(false)

      const data = readContextFileDrag(e.dataTransfer)
      if (!data) return
      onFilesDrop({
        files: [data],
        source: 'internal-file-dnd',
      })
    },
    [onFilesDrop],
  )

  return (
    <div
      data-context-file-dropzone
      className={cn(className, 'relative')}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {isDragOver && <DropOverlay />}
    </div>
  )
}
