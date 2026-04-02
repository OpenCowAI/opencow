// SPDX-License-Identifier: Apache-2.0

import { useCallback } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FileIcon } from './FileIcon'
import type { FileEntry } from '@shared/types'
import type { FileDecoration } from '@/lib/gitDecorations'
import { writeContextFileDrag } from '@/lib/contextFileDnd'
import { setContextFileDragPreview } from '@/lib/contextFileDragPreview'

interface FileTreeNodeProps {
  entry: FileEntry
  depth: number
  isExpanded: boolean
  isActive: boolean
  /** Roving tabindex value computed by the parent tree. */
  tabIndex: 0 | -1
  /** Single click handler — parent decides what to do (toggle dir / open file). */
  onClick: (entry: FileEntry) => void
  /** Git (or other source) visual decoration for this node. */
  decoration?: FileDecoration
  children?: React.ReactNode
}

export function FileTreeNode({
  entry,
  depth,
  isExpanded,
  isActive,
  tabIndex,
  onClick,
  decoration,
  children,
}: FileTreeNodeProps): React.JSX.Element {
  const paddingLeft = 12 + depth * 16

  /**
   * Native HTML5 dragstart handler.
   *
   * Sets a custom MIME type (`application/x-opencow-file`) with serialised
   * entry metadata so the Issue detail panel's ContextFileDragZone can
   * identify the drag source and extract file/directory info on drop.
   */
  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      writeContextFileDrag(e.dataTransfer, {
        path: entry.path,
        name: entry.name,
        isDirectory: entry.isDirectory,
      })
      setContextFileDragPreview(e.dataTransfer, {
        name: entry.name,
        isDirectory: entry.isDirectory,
        sourceElement: e.currentTarget as HTMLElement,
        pointerClient: { clientX: e.clientX, clientY: e.clientY },
      })
    },
    [entry.path, entry.name, entry.isDirectory],
  )

  return (
    <>
      <div
        role="treeitem"
        aria-expanded={entry.isDirectory ? isExpanded : undefined}
        aria-selected={isActive}
        tabIndex={tabIndex}
        data-tree-path={entry.path}
        draggable
        onDragStart={handleDragStart}
        className={cn(
          'flex items-center gap-1 py-0.5 pr-2 text-[13px] cursor-pointer select-none',
          'hover:bg-[hsl(var(--foreground)/0.04)] transition-colors',
          'outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-inset',
          isActive && 'bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--foreground))]'
        )}
        style={{ paddingLeft }}
        onClick={() => onClick(entry)}
        title={decoration?.tooltip ?? undefined}
      >
        {entry.isDirectory ? (
          isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <FileIcon
          filename={entry.name}
          isDirectory={entry.isDirectory}
          isExpanded={isExpanded}
          className={entry.isDirectory ? 'h-3.5 w-3.5 shrink-0' : 'h-4 w-4 shrink-0'}
        />
        <span className={cn('truncate', decoration?.colorClass)}>{entry.name}</span>
        {decoration?.badge && (
          <span
            className={cn(
              'ml-auto shrink-0 text-[10px] font-mono leading-none',
              decoration.colorClass,
            )}
            aria-label={decoration.tooltip ?? undefined}
          >
            {decoration.badge}
          </span>
        )}
      </div>
      {entry.isDirectory && isExpanded && children}
    </>
  )
}
