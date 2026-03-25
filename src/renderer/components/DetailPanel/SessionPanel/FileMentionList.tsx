// SPDX-License-Identifier: Apache-2.0

import { memo, useEffect, useRef, forwardRef } from 'react'
import { Folder, FolderOpen, CornerDownLeft } from 'lucide-react'
import { FileIcon } from '../../FilesView/FileIcon'
import type { FileEntry } from '@shared/types'

interface FileMentionListProps {
  items: FileEntry[]
  activeIndex: number
  onSelect: (item: FileEntry) => void
  /** Called when user wants to navigate into a directory (Tab or click) */
  onTabIntoDir?: (item: FileEntry) => void
}

/**
 * Dropdown list for the inline `@` file mention suggestion.
 * Renders matching file/directory entries with icons and keyboard navigation.
 *
 * - Tab on directory → navigates into it (shows children)
 * - Tab on file / Enter on any → selects and inserts as mention
 */
export const FileMentionList = forwardRef<HTMLDivElement, FileMentionListProps>(
  function FileMentionList({ items, activeIndex, onSelect, onTabIntoDir }, ref) {
    if (items.length === 0) {
      return (
        <div
          ref={ref}
          role="listbox"
          className="min-w-[220px] max-w-[340px] rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-lg py-1 text-xs text-[hsl(var(--muted-foreground))] px-2.5 py-2"
        >
          No matching files
        </div>
      )
    }

    return (
      <div
        ref={ref}
        role="listbox"
        className="min-w-[220px] max-w-[340px] max-h-56 overflow-y-auto rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-lg py-1"
      >
        {items.map((item, i) => (
          <FileMentionItem
            key={item.path}
            item={item}
            isActive={i === activeIndex}
            onSelect={onSelect}
            onTabIntoDir={onTabIntoDir}
          />
        ))}
      </div>
    )
  },
)

const FileMentionItem = memo(function FileMentionItem({
  item,
  isActive,
  onSelect,
  onTabIntoDir,
}: {
  item: FileEntry
  isActive: boolean
  onSelect: (item: FileEntry) => void
  onTabIntoDir?: (item: FileEntry) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isActive && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest' })
    }
  }, [isActive])

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={isActive}
      className={`flex items-center gap-1.5 px-2.5 py-1 cursor-pointer text-xs ${
        isActive
          ? 'bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--accent-foreground))]'
          : 'text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]'
      }`}
      onClick={() => {
        if (item.isDirectory && onTabIntoDir) {
          onTabIntoDir(item)
        } else {
          onSelect(item)
        }
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {item.isDirectory ? (
        <FolderOpen className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
      ) : (
        <FileIcon filename={item.name} className="w-3.5 h-3.5 shrink-0" />
      )}
      <span className="truncate font-medium">{item.name}</span>
      {/* Show parent dir as hint when path has depth */}
      {item.path.includes('/') && (
        <span className="ml-auto text-[10px] text-[hsl(var(--muted-foreground))] truncate max-w-[120px]">
          {item.path.substring(0, item.path.lastIndexOf('/'))}
        </span>
      )}
      {/* Tab hint for directories */}
      {item.isDirectory && isActive && (
        <span className="ml-auto flex items-center gap-0.5 text-[10px] text-[hsl(var(--muted-foreground))] opacity-70 shrink-0">
          <kbd className="px-1 py-0 rounded bg-[hsl(var(--muted)/0.5)] text-[9px] font-mono leading-tight">Tab</kbd>
          <CornerDownLeft className="w-2.5 h-2.5" />
        </span>
      )}
    </div>
  )
})
